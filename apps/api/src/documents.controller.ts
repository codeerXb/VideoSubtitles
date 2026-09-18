import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { documentPayloadSchema, generateDocumentSchema } from "@video-to-doc/contracts";
import { renderMarkdown } from "@video-to-doc/core";
import { Document as DocxDocument, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { AuthService } from "./auth.service";
import { PrismaService } from "./prisma.service";
import { QueueService } from "./queue.service";

@Controller("v1/documents")
export class DocumentsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuthService) private readonly auth: AuthService, @Inject(QueueService) private readonly queue: QueueService) {}

  @Post("/from-capture/:captureId")
  async generate(@Req() request: Request, @Param("captureId") captureId: string, @Body() body: unknown) {
    const owner = this.auth.readSession(request).userId;
    const options = generateDocumentSchema.parse(body);
    const capture = await this.prisma.captureTask.findFirst({ where: { id: captureId, userId: owner }, include: { transcript: true } });
    if (!capture) throw new BadRequestException("任务不存在");
    if (!capture.transcript) throw new BadRequestException("逐字稿尚未生成");
    await this.queue.add("generate-document", { captureId, template: options.template, outputLanguage: options.outputLanguage });
    return { status: "PROCESSING", captureId, ...options };
  }

  @Get()
  list(@Req() request: Request) {
    const owner = this.auth.readSession(request).userId;
    return this.prisma.document.findMany({ where: { captureTask: { userId: owner } }, orderBy: { updatedAt: "desc" }, include: { captureTask: { include: { videoSource: true } } } });
  }

  @Get(":id")
  async detail(@Req() request: Request, @Param("id") id: string) {
    const owner = this.auth.readSession(request).userId;
    const document = await this.prisma.document.findFirst({ where: { id, captureTask: { userId: owner } }, include: { captureTask: { include: { videoSource: true, transcript: { include: { segments: { orderBy: { order: "asc" } } } } } }, revisions: { orderBy: { createdAt: "desc" }, take: 10 } } });
    if (!document) throw new BadRequestException("文档不存在");
    return document;
  }

  @Patch(":id")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: { content: string }) {
    const owner = this.auth.readSession(request).userId;
    if (typeof body.content !== "string" || body.content.length > 500_000) throw new BadRequestException("文档内容无效");
    const document = await this.prisma.document.findFirst({ where: { id, captureTask: { userId: owner } } });
    if (!document) throw new BadRequestException("文档不存在");
    await this.prisma.$transaction([
      this.prisma.document.update({ where: { id }, data: { userContent: body.content } }),
      this.prisma.documentRevision.create({ data: { documentId: id, content: body.content } }),
    ]);
    return { ok: true };
  }

  @Get(":id/export")
  async export(@Req() request: Request, @Param("id") id: string, @Query("format") format: string | undefined, @Res() response: Response) {
    const owner = this.auth.readSession(request).userId;
    const document = await this.prisma.document.findFirst({ where: { id, captureTask: { userId: owner } }, include: { captureTask: { include: { videoSource: true } } } });
    if (!document) throw new BadRequestException("文档不存在");
    const payload = documentPayloadSchema.parse(document.payload);
    const markdown = renderMarkdown({ sourceTitle: document.captureTask.videoSource.title, sourceUrl: document.captureTask.videoSource.sourceUrl, platform: document.captureTask.videoSource.platform, document: payload });
    if (format !== "docx") {
      response.setHeader("content-type", "text/markdown; charset=utf-8");
      response.setHeader("content-disposition", `attachment; filename="video-to-doc-${id}.md"`);
      return response.send(document.userContent ?? markdown);
    }
    const docx = new DocxDocument({ sections: [{ children: [
      new Paragraph({ text: payload.title, heading: HeadingLevel.TITLE }),
      new Paragraph({ children: [new TextRun(`来源：${document.captureTask.videoSource.sourceUrl}`)] }),
      new Paragraph({ text: payload.summary }),
      ...payload.sections.flatMap((section) => [new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }), new Paragraph({ text: `${section.body}\n时间点：${Math.floor(section.startMs / 1_000)}s` })]),
    ] }] });
    const buffer = await Packer.toBuffer(docx);
    response.setHeader("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    response.setHeader("content-disposition", `attachment; filename="video-to-doc-${id}.docx"`);
    return response.send(buffer);
  }
}
