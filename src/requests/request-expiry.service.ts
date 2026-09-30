import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { expiryMessage, expiryReason } from './request-expiry';

/** Solo se avisa de vencimientos recientes (evita una avalancha con publicaciones muy viejas). */
const NOTIFY_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Cierra las publicaciones que vencieron (ver request-expiry.ts): pasan a
 * EXPIRED, sus ofertas pendientes quedan rechazadas y se avisa al solicitante
 * y a los ofertantes. Corre cada 10 minutos; el feed y las ofertas además las
 * filtran al instante, así que el cron solo "archiva".
 */
@Injectable()
export class RequestExpiryService {
  private readonly logger = new Logger(RequestExpiryService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('*/10 * * * *')
  async expireDue(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const open = await this.prisma.serviceRequest.findMany({
        where: { status: { in: ['PUBLISHED', 'IN_PROPOSALS'] } },
        select: {
          id: true, title: true, status: true, createdAt: true, expiresAt: true, scheduledAt: true, requesterId: true,
          proposals: { where: { status: 'PENDING' }, select: { id: true, providerId: true } },
        },
      });

      let expired = 0;
      for (const r of open) {
        const reason = expiryReason({ ...r, pendingProposals: r.proposals.length }, now);
        if (!reason) continue;

        // Solo si sigue abierta (otra instancia o el usuario pudo cambiarla)
        const { count } = await this.prisma.serviceRequest.updateMany({
          where: { id: r.id, status: { in: ['PUBLISHED', 'IN_PROPOSALS'] } },
          data: { status: 'EXPIRED' },
        });
        if (!count) continue;
        expired++;
        if (r.proposals.length) {
          await this.prisma.proposal.updateMany({ where: { requestId: r.id, status: 'PENDING' }, data: { status: 'REJECTED' } });
        }

        const deadline = reason === 'NO_OFFERS' ? r.expiresAt : null;
        if (deadline && now.getTime() - deadline.getTime() > NOTIFY_WINDOW_MS) continue;
        const msg = expiryMessage(r.title, reason);
        await this.notifications.notify({ profileId: r.requesterId, type: 'REQUEST_EXPIRED', title: msg.title, body: msg.body, entityType: 'request', entityId: r.id });
        for (const p of r.proposals) {
          await this.notifications.notify({
            profileId: p.providerId, type: 'PROPOSAL_REJECTED', title: 'Una solicitud venció',
            body: `«${r.title}» venció sin que el solicitante eligiera una oferta.`, entityType: 'request', entityId: r.id,
          });
        }
      }
      if (expired) this.logger.log(`${expired} publicación(es) vencida(s)`);
      return expired;
    } catch (err) {
      this.logger.error(`No se pudieron vencer publicaciones: ${(err as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
