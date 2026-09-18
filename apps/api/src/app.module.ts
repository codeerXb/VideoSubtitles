import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { CapturesController } from "./captures.controller";
import { DocumentsController } from "./documents.controller";
import { ObjectStorageService } from "./object-storage.service";
import { PrismaCaptureRepository } from "./prisma-capture.repository";
import { PrismaService } from "./prisma.service";
import { QueueService } from "./queue.service";
import { QuotaController } from "./quota.controller";
import { HealthController } from "./health.controller";

@Module({
  controllers: [HealthController, AuthController, CapturesController, DocumentsController, QuotaController],
  providers: [PrismaService, AuthService, PrismaCaptureRepository, ObjectStorageService, QueueService],
})
export class AppModule {}
