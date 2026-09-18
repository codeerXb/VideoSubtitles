import { BadRequestException, Body, Controller, Delete, Get, Headers, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { subtitleSubmissionSchema } from "@video-to-doc/contracts";
import { CaptureService } from "./capture.service";
import { PrismaService } from "./prisma.service";
import { PrismaCaptureRepository } from "./prisma-capture.repository";
import { AuthService } from "./auth.service";
import { ObjectStorageService } from "./object-storage.service";
import { QueueService } from "./queue.service";

function userId(auth: AuthService, request: Request): string { return auth.readSession(request).userId; }
function periodKey(date = new Date()): string { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }

@Controller("v1/captures")
export class CapturesController {
  private readonly captures: CaptureService;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrismaCaptureRepository) private readonly repository: PrismaCaptureRepository,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @Inject(QueueService) private readonly queue: QueueService,
  ) { this.captures = new CaptureService(repository); }

  @Post()
  async create(@Req() request: Request, @Headers("x-idempotency-key") idempotencyKey: string | undefined, @Body() body: unknown) {
    const record = await this.captures.create(userId(this.auth, request), body, idempotencyKey ?? crypto.randomUUID());
    return { id: record.id, status: record.status, sourceUrl: record.sourceUrl };
  }

  @Post(":id/subtitles")
  async submitSubtitles(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const owner = userId(this.auth, request);
    const capture = await this.captures.getOwned(id, owner);
    if (capture.acquisitionMethod !== "CAPTION") throw new BadRequestException("该任务不是字幕采集任务");
    const submission = subtitleSubmissionSchema.parse(body);
    await this.prisma.$transaction(async (tx) => {
      await tx.transcript.deleteMany({ where: { captureTaskId: id } });
      const transcript = await tx.transcript.create({ data: { captureTaskId: id, language: submission.language } });
      await tx.transcriptSegment.createMany({ data: submission.segments.map((segment, index) => ({ transcriptId: transcript.id, order: index, ...segment })) });
      await tx.captureTask.update({ where: { id }, data: { status: "PROCESSING", language: submission.language } });
      await tx.usageLedger.upsert({ where: { captureTaskId: id }, update: {}, create: { userId: owner, captureTaskId: id, durationMs: capture.durationMs, periodKey: periodKey() } });
    });
    await this.queue.add("process-caption", { captureId: id });
    return { id, status: "PROCESSING" };
  }

  @Post(":id/chunks/presign")
  async presignChunk(@Req() request: Request, @Param("id") id: string, @Body() body: { index: number; contentType: string; size: number }) {
    const owner = userId(this.auth, request);
    await this.captures.getOwned(id, owner);
    if (!Number.isInteger(body.index) || body.index < 0 || body.index > 24_000) throw new BadRequestException("分片序号无效");
    if (!Number.isInteger(body.size) || body.size <= 0 || body.size > 10 * 1024 * 1024) throw new BadRequestException("分片大小无效");
    const key = `captures/${owner}/${id}/${body.index}.webm`;
    const chunk = await this.prisma.audioChunk.upsert({ where: { captureTaskId_index: { captureTaskId: id, index: body.index } }, update: { size: body.size, contentType: body.contentType }, create: { captureTaskId: id, index: body.index, objectKey: key, contentType: body.contentType, size: body.size } });
    return { chunkId: chunk.id, uploadUrl: await this.storage.presignPut(key, body.contentType) };
  }

  @Post(":id/chunks/:chunkId/complete")
  async completeChunk(@Req() request: Request, @Param("id") id: string, @Param("chunkId") chunkId: string) {
    const owner = userId(this.auth, request);
    await this.captures.getOwned(id, owner);
    const chunk = await this.prisma.audioChunk.findFirst({ where: { id: chunkId, captureTaskId: id } });
    if (!chunk) throw new BadRequestException("分片不存在");
    await this.prisma.audioChunk.update({ where: { id: chunkId }, data: { uploaded: true } });
    return { ok: true };
  }

  @Post(":id/complete")
  async complete(@Req() request: Request, @Param("id") id: string) {
    const owner = userId(this.auth, request);
    const capture = await this.captures.getOwned(id, owner);
    if (capture.acquisitionMethod !== "TAB_AUDIO") throw new BadRequestException("该任务不是音频采集任务");
    const chunks = await this.prisma.audioChunk.findMany({ where: { captureTaskId: id } });
    if (!chunks.length || chunks.some((chunk) => !chunk.uploaded)) throw new BadRequestException("仍有音频分片未上传");
    await this.prisma.$transaction(async (tx) => {
      await tx.captureTask.update({ where: { id }, data: { status: "PROCESSING" } });
      await tx.usageLedger.upsert({ where: { captureTaskId: id }, update: {}, create: { userId: owner, captureTaskId: id, durationMs: capture.durationMs, periodKey: periodKey() } });
    });
    await this.queue.add("process-audio", { captureId: id });
    return { id, status: "PROCESSING" };
  }

  @Post(":id/cancel")
  async cancel(@Req() request: Request, @Param("id") id: string) {
    const owner = userId(this.auth, request);
    await this.captures.getOwned(id, owner);
    await this.prisma.captureTask.update({ where: { id }, data: { status: "CANCELED" } });
    return { id, status: "CANCELED" };
  }

  @Post(":id/retry")
  async retry(@Req() request: Request, @Param("id") id: string) {
    const owner = userId(this.auth, request);
    const capture = await this.captures.getOwned(id, owner);
    await this.prisma.captureTask.update({ where: { id }, data: { status: "PROCESSING", failureMessage: null } });
    await this.queue.add(capture.acquisitionMethod === "CAPTION" ? "process-caption" : "process-audio", { captureId: id });
    return { id, status: "PROCESSING" };
  }

  @Get()
  async list(@Req() request: Request) {
    const owner = userId(this.auth, request);
    return this.prisma.captureTask.findMany({ where: { userId: owner }, orderBy: { createdAt: "desc" }, include: { videoSource: true, transcript: { select: { id: true } }, documents: { select: { id: true, template: true, outputLanguage: true, title: true, updatedAt: true } } } });
  }

  @Get(":id")
  async detail(@Req() request: Request, @Param("id") id: string) {
    const owner = userId(this.auth, request);
    await this.captures.getOwned(id, owner);
    const task = await this.prisma.captureTask.findFirst({ where: { id, userId: owner }, include: { videoSource: true, transcript: { include: { segments: { orderBy: { order: "asc" } } } }, documents: { include: { revisions: { orderBy: { createdAt: "desc" }, take: 10 } } }, audioChunks: { select: { index: true, uploaded: true } } } });
    return task;
  }

  @Delete(":id")
  async remove(@Req() request: Request, @Param("id") id: string) {
    const owner = userId(this.auth, request);
    await this.captures.getOwned(id, owner);
    const chunks = await this.prisma.audioChunk.findMany({ where: { captureTaskId: id }, select: { objectKey: true } });
    await this.prisma.captureTask.delete({ where: { id } });
    await this.queue.add("cleanup-capture", { objectKeys: chunks.map((chunk) => chunk.objectKey) });
    return { ok: true };
  }
}
