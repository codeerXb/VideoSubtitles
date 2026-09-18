import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  readonly queue = new Queue("video-to-doc", { connection: this.connection });
  add(name: string, data: Record<string, unknown>) {
    return this.queue.add(name, data, {
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }
  async onModuleDestroy() { await this.queue.close(); await this.connection.quit(); }
}
