import type { CreateCaptureInput, TaskStatus } from "@video-to-doc/contracts";
import { createCaptureSchema } from "@video-to-doc/contracts";
import { canProcessDuration } from "@video-to-doc/core";
import { BadRequestException, NotFoundException } from "@nestjs/common";

export interface CaptureRecord extends CreateCaptureInput {
  id: string;
  userId: string;
  idempotencyKey: string;
  status: TaskStatus;
}

export interface CaptureRepository {
  monthlyUsageMs(userId: string): Promise<number>;
  findByIdempotencyKey(userId: string, key: string): Promise<CaptureRecord | null>;
  create(userId: string, input: CreateCaptureInput, idempotencyKey: string): Promise<CaptureRecord>;
  findOwned(id: string, userId: string): Promise<CaptureRecord | null>;
}

export class CaptureService {
  constructor(private readonly repository: CaptureRepository) {}

  async create(userId: string, input: unknown, idempotencyKey: string): Promise<CaptureRecord> {
    if (!idempotencyKey.trim()) throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");
    const existing = await this.repository.findByIdempotencyKey(userId, idempotencyKey);
    if (existing) return existing;
    const parsed = createCaptureSchema.parse(input);
    const usedMs = await this.repository.monthlyUsageMs(userId);
    const decision = canProcessDuration(usedMs, parsed.durationMs);
    if (!decision.allowed) throw new BadRequestException(decision.reason);
    return this.repository.create(userId, parsed, idempotencyKey);
  }

  async getOwned(id: string, userId: string): Promise<CaptureRecord> {
    const capture = await this.repository.findOwned(id, userId);
    if (!capture) throw new NotFoundException("CAPTURE_NOT_FOUND");
    return capture;
  }
}
