import { describe, expect, it } from "vitest";
import type { CreateCaptureInput } from "@video-to-doc/contracts";
import { CaptureService, type CaptureRecord, type CaptureRepository } from "../src/capture.service";

class MemoryCaptureRepository implements CaptureRepository {
  records: CaptureRecord[] = [];
  usageByUser = new Map<string, number>();

  async monthlyUsageMs(userId: string): Promise<number> { return this.usageByUser.get(userId) ?? 0; }
  async findByIdempotencyKey(userId: string, key: string): Promise<CaptureRecord | null> {
    return this.records.find((record) => record.userId === userId && record.idempotencyKey === key) ?? null;
  }
  async create(userId: string, input: CreateCaptureInput, idempotencyKey: string): Promise<CaptureRecord> {
    const record: CaptureRecord = { id: `capture-${this.records.length + 1}`, userId, idempotencyKey, status: input.acquisitionMethod === "TAB_AUDIO" ? "CAPTURING" : "CREATED", ...input };
    this.records.push(record);
    return record;
  }
  async findOwned(id: string, userId: string): Promise<CaptureRecord | null> {
    return this.records.find((record) => record.id === id && record.userId === userId) ?? null;
  }
}

const validInput: CreateCaptureInput = {
  platform: "YOUTUBE",
  acquisitionMethod: "CAPTION",
  sourceId: "abc",
  sourceUrl: "https://www.youtube.com/watch?v=abc",
  title: "Course",
  durationMs: 600_000,
};

describe("CaptureService", () => {
  it("returns the original capture when an idempotency key is retried", async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);
    const first = await service.create("user-1", validInput, "request-1");
    const second = await service.create("user-1", validInput, "request-1");
    expect(second.id).toBe(first.id);
    expect(repository.records).toHaveLength(1);
  });

  it("rejects a capture that would exceed the monthly five-hour quota", async () => {
    const repository = new MemoryCaptureRepository();
    repository.usageByUser.set("user-1", 17_700_000);
    const service = new CaptureService(repository);
    await expect(service.create("user-1", { ...validInput, durationMs: 600_000 }, "request-2")).rejects.toThrow("MONTHLY_QUOTA_EXCEEDED");
    expect(repository.records).toHaveLength(0);
  });

  it("does not reveal another user's capture", async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);
    const capture = await service.create("owner", validInput, "request-3");
    await expect(service.getOwned(capture.id, "other-user")).rejects.toThrow("CAPTURE_NOT_FOUND");
  });
});
