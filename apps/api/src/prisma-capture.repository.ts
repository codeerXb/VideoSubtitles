import { Inject, Injectable } from "@nestjs/common";
import type { CreateCaptureInput } from "@video-to-doc/contracts";
import type { CaptureRecord, CaptureRepository } from "./capture.service";
import { PrismaService } from "./prisma.service";

function periodKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

@Injectable()
export class PrismaCaptureRepository implements CaptureRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async monthlyUsageMs(userId: string): Promise<number> {
    const aggregate = await this.prisma.usageLedger.aggregate({
      where: { userId, periodKey: periodKey() },
      _sum: { durationMs: true },
    });
    return aggregate._sum.durationMs ?? 0;
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<CaptureRecord | null> {
    const task = await this.prisma.captureTask.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
      include: { videoSource: true },
    });
    return task ? this.toRecord(task) : null;
  }

  async create(userId: string, input: CreateCaptureInput, idempotencyKey: string): Promise<CaptureRecord> {
    const task = await this.prisma.captureTask.create({
      data: {
        user: { connect: { id: userId } },
        idempotencyKey,
        acquisitionMethod: input.acquisitionMethod,
        status: input.acquisitionMethod === "TAB_AUDIO" ? "CAPTURING" : "CREATED",
        videoSource: { create: { user: { connect: { id: userId } }, platform: input.platform, sourceId: input.sourceId, sourceUrl: input.sourceUrl, title: input.title, durationMs: input.durationMs } },
      },
      include: { videoSource: true },
    });
    return this.toRecord(task);
  }

  async findOwned(id: string, userId: string): Promise<CaptureRecord | null> {
    const task = await this.prisma.captureTask.findFirst({ where: { id, userId }, include: { videoSource: true } });
    return task ? this.toRecord(task) : null;
  }

  private toRecord(task: any): CaptureRecord {
    return {
      id: task.id,
      userId: task.userId,
      idempotencyKey: task.idempotencyKey,
      status: task.status,
      acquisitionMethod: task.acquisitionMethod,
      platform: task.videoSource.platform,
      sourceId: task.videoSource.sourceId,
      sourceUrl: task.videoSource.sourceUrl,
      title: task.videoSource.title,
      durationMs: task.videoSource.durationMs,
    };
  }
}
