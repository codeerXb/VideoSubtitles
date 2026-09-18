import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { documentPayloadSchema, type DocumentTemplate, type OutputLanguage } from "@video-to-doc/contracts";
import { normalizeTranscript } from "@video-to-doc/core";
import { PrismaClient } from "@prisma/client";
import { OpenAIDocumentProvider, OpenAITranscriptionProvider, type DocumentProvider, type TranscriptionProvider } from "./ai";

const execFileAsync = promisify(execFile);

export class VideoJobProcessor {
  private readonly bucket = process.env.S3_BUCKET ?? "video-to-doc";
  private readonly storage = new S3Client({ region: process.env.S3_REGION ?? "us-east-1", endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000", forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin", secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin" } });
  constructor(private readonly prisma: PrismaClient, private readonly transcription: TranscriptionProvider = new OpenAITranscriptionProvider(), private readonly documents: DocumentProvider = new OpenAIDocumentProvider()) {}

  async processCaption(captureId: string): Promise<void> {
    await this.prisma.captureTask.update({ where: { id: captureId }, data: { status: "PROCESSING", failureMessage: null } });
    try {
      await this.generateDocument(captureId, "STRUCTURED_NOTES", "ZH_CN");
      await this.prisma.captureTask.update({ where: { id: captureId }, data: { status: "READY" } });
    } catch (error) {
      await this.prisma.captureTask.update({ where: { id: captureId }, data: { status: "FAILED", failureMessage: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }

  async processAudio(captureId: string): Promise<void> {
    await this.prisma.captureTask.update({ where: { id: captureId }, data: { status: "PROCESSING", failureMessage: null } });
    const task = await this.prisma.captureTask.findUnique({ where: { id: captureId }, include: { audioChunks: { where: { uploaded: true }, orderBy: { index: "asc" } }, videoSource: true } });
    if (!task || !task.audioChunks.length) throw new Error("AUDIO_CHUNKS_MISSING");
    const workDir = await mkdtemp(`${tmpdir()}/video-to-doc-`);
    try {
      const inputList = await Promise.all(task.audioChunks.map(async (chunk, position) => {
        const object = await this.storage.send(new GetObjectCommand({ Bucket: this.bucket, Key: chunk.objectKey }));
        const body = object.Body;
        if (!body) throw new Error("AUDIO_OBJECT_EMPTY");
        const bytes = Buffer.from(await body.transformToByteArray());
        const path = `${workDir}/${String(position).padStart(6, "0")}.webm`;
        await writeFile(path, bytes);
        return path;
      }));
      const listPath = `${workDir}/concat.txt`;
      await writeFile(listPath, inputList.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n"));
      const audioPath = `${workDir}/audio.wav`;
      await execFileAsync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-ar", "16000", "-ac", "1", audioPath]);
      const result = await this.transcription.transcribe(audioPath);
      const transcript = normalizeTranscript(result.segments);
      await this.prisma.$transaction(async (tx) => {
        await tx.transcript.deleteMany({ where: { captureTaskId: captureId } });
        const created = await tx.transcript.create({ data: { captureTaskId: captureId, language: result.language } });
        await tx.transcriptSegment.createMany({ data: transcript.map((segment, order) => ({ transcriptId: created.id, order, ...segment })) });
      });
      await this.generateDocument(captureId, "STRUCTURED_NOTES", "ZH_CN");
      await this.prisma.captureTask.update({ where: { id: captureId }, data: { status: "READY", language: result.language, failureMessage: null } });
    } catch (error) {
      await this.prisma.captureTask.update({ where: { id: captureId }, data: { status: "FAILED", failureMessage: error instanceof Error ? error.message : String(error) } });
      throw error;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async generateDocument(captureId: string, template: DocumentTemplate, outputLanguage: OutputLanguage): Promise<void> {
    const task = await this.prisma.captureTask.findUnique({ where: { id: captureId }, include: { videoSource: true, transcript: { include: { segments: { orderBy: { order: "asc" } } } } } });
    if (!task?.transcript) throw new Error("TRANSCRIPT_MISSING");
    const payload = documentPayloadSchema.parse(await this.documents.generate({ sourceTitle: task.videoSource.title, template, outputLanguage, segments: task.transcript.segments }));
    await this.prisma.document.upsert({ where: { captureTaskId_template_outputLanguage: { captureTaskId: captureId, template, outputLanguage } }, update: { title: payload.title, summary: payload.summary, payload }, create: { captureTaskId: captureId, template, outputLanguage, title: payload.title, summary: payload.summary, payload } });
  }

  async cleanup(objectKeys: string[]): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await Promise.all(objectKeys.map((key) => this.storage.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))));
  }

  async expireOldAudio(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const chunks = await this.prisma.audioChunk.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true, objectKey: true } });
    if (!chunks.length) return;
    await this.cleanup(chunks.map((chunk) => chunk.objectKey));
    await this.prisma.audioChunk.deleteMany({ where: { id: { in: chunks.map((chunk) => chunk.id) } } });
  }
}
