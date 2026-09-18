import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Request } from "express";
import { MONTHLY_QUOTA_MS } from "@video-to-doc/core";
import { AuthService } from "./auth.service";
import { PrismaService } from "./prisma.service";

@Controller("v1/quota")
export class QuotaController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  async get(@Req() request: Request) {
    const userId = this.auth.readSession(request).userId;
    const now = new Date();
    const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const aggregate = await this.prisma.usageLedger.aggregate({ where: { userId, periodKey }, _sum: { durationMs: true } });
    const usedMs = aggregate._sum.durationMs ?? 0;
    return { usedMs, remainingMs: Math.max(0, MONTHLY_QUOTA_MS - usedMs), maxTaskMs: 3_600_000 };
  }
}
