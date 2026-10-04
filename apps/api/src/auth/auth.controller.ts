import { Body, Controller, Post } from "@nestjs/common";
import { RateLimit } from "../security/rate-limit.guard";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Fuerza bruta: 10 intentos por cuenta y 50 por IP cada 15 minutos. */
  @Post("login")
  @RateLimit(
    { name: "login-email", limit: 10, windowSec: 900, by: "email" },
    { name: "login-ip", limit: 50, windowSec: 900 },
  )
  login(
    @Body() body: { email?: string; password?: string; tenantSlug?: string },
  ) {
    return this.auth.login(body.email ?? "", body.password ?? "", body.tenantSlug);
  }
}
