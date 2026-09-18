import { Body, Controller, Get, Inject, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";

function accessCookieOptions() { return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 15 * 60 * 1_000, path: "/" }; }
function refreshCookieOptions() { return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 30 * 24 * 60 * 60 * 1_000, path: "/v1/auth" }; }

@Controller("v1/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("request-link")
  requestLink(@Body() body: { email: string; returnTo?: string }) { return this.auth.requestMagicLink(body.email, body.returnTo); }

  @Get("verify")
  async verify(@Query("token") token: string, @Query("return_to") returnTo: string | undefined, @Res() response: Response) {
    const result = await this.auth.verifyMagicLink(token);
    const pair = await this.auth.issueTokenPair(result.userId);
    response.cookie("vtd_session", pair.accessToken, accessCookieOptions());
    response.cookie("vtd_refresh", pair.refreshToken, refreshCookieOptions());
    const target = result.returnTo ?? returnTo ?? `${process.env.PUBLIC_WEB_URL ?? "http://localhost:5173"}/tasks`;
    return response.redirect(target);
  }

  @Get("extension/authorize")
  async authorize(@Req() request: Request, @Query("redirect_uri") redirectUri: string, @Res() response: Response) {
    try {
      const session = this.auth.readSession(request);
      const code = await this.auth.issueExtensionCode(session.userId, redirectUri);
      return response.redirect(`${redirectUri}?code=${encodeURIComponent(code)}`);
    } catch {
      const webUrl = process.env.PUBLIC_WEB_URL ?? "http://localhost:5173";
      return response.redirect(`${webUrl}/login?return_to=${encodeURIComponent(`${process.env.PUBLIC_API_URL ?? "http://localhost:3000"}/v1/auth/extension/authorize?redirect_uri=${redirectUri}`)}`);
    }
  }

  @Post("extension/token")
  exchange(@Body() body: { code: string; redirectUri: string }) { return this.auth.exchangeExtensionCode(body.code, body.redirectUri); }

  @Post("refresh")
  async refresh(@Body() body: { refreshToken?: string }, @Req() request: Request, @Res() response: Response) {
    const refreshToken = body.refreshToken ?? request.cookies?.vtd_refresh;
    if (!refreshToken) throw new UnauthorizedException("缺少刷新令牌");
    const pair = await this.auth.refresh(refreshToken);
    response.cookie("vtd_session", pair.accessToken, accessCookieOptions());
    response.cookie("vtd_refresh", pair.refreshToken, refreshCookieOptions());
    return response.json({ ok: true });
  }

  @Get("session")
  session(@Req() request: Request) { return this.auth.readSession(request); }
}
