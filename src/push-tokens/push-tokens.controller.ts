import { Controller, Post, Delete, Body } from '@nestjs/common';
import { PushTokensService } from './push-tokens.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('push-tokens')
export class PushTokensController {
  constructor(private readonly pushTokensService: PushTokensService) {}

  /** Registrar el token de push del dispositivo actual (al iniciar sesión / abrir la app). */
  @Post()
  register(@CurrentUser() user: any, @Body() dto: RegisterPushTokenDto) {
    return this.pushTokensService.register(user.userId, dto);
  }

  /** Dejar de recibir push en este dispositivo (ej. logout). */
  @Delete()
  remove(@CurrentUser() user: any, @Body('token') token: string) {
    return this.pushTokensService.remove(user.userId, token);
  }
}
