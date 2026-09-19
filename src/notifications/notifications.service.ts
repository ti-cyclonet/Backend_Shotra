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

  /**
   * Crear una notificación para un perfil. No lanza si falla (best-effort).
   * Además dispara un push real (Expo Push API) a los dispositivos
   * registrados de ese perfil, para que llegue aunque la app esté minimizada
   * o cerrada — el registro en BD por sí solo solo sirve mientras la app
   * está corriendo y hace polling.
   */
  async notify(input: NotifyInput) {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          profileId: input.profileId,
          type: input.type as any,
          title: input.title,
          body: input.body,
          entityType: input.entityType,
          entityId: input.entityId,
        },
      });

      this.sendPush(input).catch((err) =>
        console.error('[NotificationsService] sendPush failed:', err),
      );

      return notification;
    } catch (err) {
      // No interrumpir el flujo de negocio por un fallo de notificación
      console.error('[NotificationsService] notify failed:', err);
      return null;
    }
  }

  /**
   * Envía la notificación como push real vía Expo Push API a todos los
   * dispositivos registrados del perfil. Best-effort: nunca lanza. Limpia de
   * la base los tokens que Expo reporta como inválidos (app desinstalada,
   * dispositivo reseteado, etc.).
   */
  private async sendPush(input: NotifyInput): Promise<void> {
    const tokens = await this.prisma.pushToken.findMany({ where: { profileId: input.profileId } });
    if (tokens.length === 0) return;

    const unread = await this.prisma.notification.count({
      where: { profileId: input.profileId, read: false },
    });

    const messages = tokens.map((t) => ({
      to: t.token,
      title: input.title,
      body: input.body,
      sound: 'default',
      badge: unread,
      data: { entityType: input.entityType, entityId: input.entityId, notificationType: input.type },
    }));

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      const data: any = await res.json().catch(() => null);
      const tickets: any[] = data?.data || [];

      // Limpiar tokens que Expo marca como inválidos definitivamente.
      const staleTokens: string[] = [];
      tickets.forEach((ticket, i) => {
        if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered') {
          staleTokens.push(tokens[i].token);
        }
      });
      if (staleTokens.length > 0) {
        await this.prisma.pushToken.deleteMany({ where: { token: { in: staleTokens } } });
      }
    } catch (err) {
      console.error('[NotificationsService] Expo push request failed:', err);
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

  /** Vaciar (borrar) todas las notificaciones del usuario — no solo marcarlas leídas. */
  async clearAll(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) return { ok: false };
    await this.prisma.notification.deleteMany({ where: { profileId: profile.id } });
    return { ok: true };
  }
}
