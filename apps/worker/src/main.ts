import { Worker } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { VideoJobProcessor } from "./worker";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const prisma = new PrismaClient();
const processor = new VideoJobProcessor(prisma);
const worker = new Worker("video-to-doc", async (job) => {
  switch (job.name) {
    case "process-caption": return processor.processCaption(String(job.data.captureId));
    case "process-audio": return processor.processAudio(String(job.data.captureId));
    case "generate-document": return processor.generateDocument(String(job.data.captureId), job.data.template, job.data.outputLanguage);
    case "cleanup-capture": return processor.cleanup(job.data.objectKeys ?? []);
    default: throw new Error(`UNKNOWN_JOB:${job.name}`);
  }
}, { connection });
worker.on("completed", (job) => console.info(`[video-to-doc] completed ${job.name}:${job.id}`));
worker.on("failed", (job, error) => console.error(`[video-to-doc] failed ${job?.name}:${job?.id}`, error));
const cleanupTimer = setInterval(() => void processor.expireOldAudio().catch((error) => console.error("audio retention failed", error)), 15 * 60 * 1_000);
const shutdown = async () => { clearInterval(cleanupTimer); await worker.close(); await connection.quit(); await prisma.$disconnect(); };
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
