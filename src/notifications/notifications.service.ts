import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type NotificationType =
  | 'NEW_PROPOSAL'
  | 'PROPOSAL_ACCEPTED'
  | 'PROPOSAL_REJECTED'
  | 'CONTRACT_SIGNED'
  | 'CONTRACT_COMPLETED'
  | 'NEW_RATING'
  | 'NEW_MESSAGE';

interface NotifyInput {
  profileId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Crear una notificación para un perfil. No lanza si falla (best-effort). */
  async notify(input: NotifyInput) {
    try {
      return await this.prisma.notification.create({
        data: {
          profileId: input.profileId,
          type: input.type as any,
          title: input.title,
          body: input.body,
          entityType: input.entityType,
          entityId: input.entityId,
        },
      });
    } catch (err) {
      // No interrumpir el flujo de negocio por un fallo de notificación
      console.error('[NotificationsService] notify failed:', err);
      return null;
    }
  }

  /** Listar notificaciones del usuario autenticado */
  async list(userId: string, onlyUnread = false) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) return { items: [], unread: 0 };

    const where: any = { profileId: profile.id };
    if (onlyUnread) where.read = false;

    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.notification.count({ where: { profileId: profile.id, read: false } }),
    ]);

    return { items, unread };
  }

  /** Marcar una notificación como leída */
  async markRead(userId: string, id: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) return { ok: false };
    await this.prisma.notification.updateMany({
      where: { id, profileId: profile.id },
      data: { read: true },
    });
    return { ok: true };
  }

  /** Marcar todas como leídas */
  async markAllRead(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) return { ok: false };
    await this.prisma.notification.updateMany({
      where: { profileId: profile.id, read: false },
      data: { read: true },
    });
    return { ok: true };
  }
}
