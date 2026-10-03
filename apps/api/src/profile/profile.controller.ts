import { Body, Controller, Get, Patch } from "@nestjs/common";
import { ProfileService } from "./profile.service";

/** Perfil público del promotor, editable desde la consola (JWT). */
@Controller("profile")
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  get() {
    return this.profile.get();
  }

  @Patch()
  update(@Body() body: Record<string, unknown>) {
    return this.profile.update(body ?? {});
  }
}
