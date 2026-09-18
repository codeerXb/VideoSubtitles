import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { PrismaService } from "./prisma.service";

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAGIC_LINK_TTL_MS = 15 * 60 * 1_000;

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function secret(): string { return process.env.JWT_SECRET ?? "local-development-secret-change-me"; }

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async requestMagicLink(emailInput: string, returnTo?: string): Promise<{ message: string; devLink?: string }> {
    const email = emailInput.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException("邮箱格式不正确");
    const invite = await this.prisma.invite.findUnique({ where: { email } });
    if (!invite) return { message: "如果邮箱在邀请名单中，你会收到登录链接。" };
    const rawToken = randomBytes(32).toString("base64url");
    await this.prisma.magicLinkToken.create({ data: { email, tokenHash: hash(rawToken), returnTo, expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS) } });
    const apiUrl = process.env.PUBLIC_API_URL ?? "http://localhost:3000";
    const link = `${apiUrl}/v1/auth/verify?token=${encodeURIComponent(rawToken)}${returnTo ? `&return_to=${encodeURIComponent(returnTo)}` : ""}`;
    if (process.env.SMTP_HOST) {
      const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: process.env.SMTP_SECURE === "true", auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
      await transport.sendMail({ from: process.env.SMTP_FROM ?? "Video to Doc <noreply@example.com>", to: email, subject: "登录 Video to Doc", text: `点击登录：${link}` });
    } else {
      console.info(`[video-to-doc] magic link for ${email}: ${link}`);
    }
    return process.env.NODE_ENV === "production" ? { message: "登录链接已发送，请检查邮箱。" } : { message: "开发环境登录链接已生成。", devLink: link };
  }

  async verifyMagicLink(rawToken: string): Promise<{ userId: string; returnTo?: string }> {
    const token = await this.prisma.magicLinkToken.findUnique({ where: { tokenHash: hash(rawToken) } });
    if (!token || token.consumedAt || token.expiresAt < new Date()) throw new UnauthorizedException("登录链接已失效");
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.magicLinkToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
      await tx.invite.updateMany({ where: { email: token.email }, data: { acceptedAt: new Date() } });
      return tx.user.upsert({ where: { email: token.email }, create: { email: token.email }, update: {} });
    });
    return { userId: user.id, returnTo: token.returnTo ?? undefined };
  }

  createAccessToken(userId: string, email: string): string {
    return jwt.sign({ sub: userId, email }, secret(), { expiresIn: ACCESS_TTL_SECONDS });
  }

  async issueRefreshToken(userId: string): Promise<string> {
    const rawToken = randomBytes(48).toString("base64url");
    await this.prisma.authToken.create({ data: { userId, kind: "REFRESH", tokenHash: hash(rawToken), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) } });
    return rawToken;
  }

  async issueTokenPair(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("用户不存在");
    return { accessToken: this.createAccessToken(user.id, user.email), refreshToken: await this.issueRefreshToken(user.id) };
  }

  verifyAccessToken(token: string): { userId: string; email: string } {
    try {
      const payload = jwt.verify(token, secret()) as { sub?: string; email?: string };
      if (!payload.sub || !payload.email) throw new Error("invalid");
      return { userId: payload.sub, email: payload.email };
    } catch { throw new UnauthorizedException("登录状态已失效"); }
  }

  async issueExtensionCode(userId: string, redirectUri: string): Promise<string> {
    if (!redirectUri.startsWith("https://") && !redirectUri.startsWith("http://localhost")) throw new BadRequestException("无效的回调地址");
    const code = randomBytes(32).toString("base64url");
    await this.prisma.authToken.create({ data: { userId, kind: "AUTH_CODE", tokenHash: hash(code), redirectUri, expiresAt: new Date(Date.now() + 5 * 60 * 1_000) } });
    return code;
  }

  async exchangeExtensionCode(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken: string }> {
    const token = await this.prisma.authToken.findFirst({ where: { tokenHash: hash(code), kind: "AUTH_CODE", consumedAt: null } });
    if (!token || token.expiresAt < new Date() || token.redirectUri !== redirectUri) throw new UnauthorizedException("授权码已失效");
    await this.prisma.authToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
    return this.issueTokenPair(token.userId);
  }

  async refresh(rawRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const token = await this.prisma.authToken.findFirst({ where: { tokenHash: hash(rawRefreshToken), kind: "REFRESH", consumedAt: null } });
    if (!token || token.expiresAt < new Date()) throw new UnauthorizedException("刷新令牌已失效");
    await this.prisma.authToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
    return this.issueTokenPair(token.userId);
  }

  readSession(request: { cookies?: Record<string, string>; headers?: Record<string, string | string[] | undefined> }): { userId: string; email: string } {
    const header = request.headers?.authorization;
    const bearer = Array.isArray(header) ? header[0] : header;
    const token = bearer?.startsWith("Bearer ") ? bearer.slice(7) : request.cookies?.vtd_session;
    if (!token) throw new UnauthorizedException("请先登录");
    return this.verifyAccessToken(token);
  }
}
