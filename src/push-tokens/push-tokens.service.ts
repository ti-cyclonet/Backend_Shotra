import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

@Injectable()
export class PushTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra (o re-asocia, si el token ya existía en otro perfil — mismo
   * dispositivo, otra cuenta) el token de push del dispositivo actual.
   * Idempotente: reintentar con el mismo token no duplica filas.
   */
  async register(userId: string, dto: RegisterPushTokenDto) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    return this.prisma.pushToken.upsert({
      where: { token: dto.token },
      update: { profileId: profile.id, platform: dto.platform },
      create: { profileId: profile.id, token: dto.token, platform: dto.platform },
    });
  }

  /** Elimina el token (ej. al cerrar sesión) para dejar de recibir push en ese dispositivo. */
  async remove(userId: string, token: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) return { message: 'ok' };

    await this.prisma.pushToken.deleteMany({ where: { token, profileId: profile.id } });
    return { message: 'ok' };
  }
}
