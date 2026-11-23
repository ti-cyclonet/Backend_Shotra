import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** Margen tras la llegada estimada antes de dar la ruta por vencida. */
const ROUTE_GRACE_MS = 60 * 60 * 1000;

/**
 * Cada 15 min:
 * - rutas ACTIVE cuya llegada estimada pasó hace más de 1 h → EXPIRED;
 * - coincidencias sugeridas cuya solicitud ya no está abierta, o cuya ruta ya
 *   no está activa → EXPIRED (dejan de aparecer en la lista del ofertante).
 */
@Injectable()
export class RouteExpiryService {
  private readonly logger = new Logger(RouteExpiryService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('*/15 * * * *')
  async expireDue(now = new Date()): Promise<{ routes: number; matches: number }> {
    if (this.running) return { routes: 0, matches: 0 };
    this.running = true;
    try {
      const routes = await this.prisma.providerRoute.updateMany({
        where: { status: 'ACTIVE', arriveAt: { lt: new Date(now.getTime() - ROUTE_GRACE_MS) } },
        data: { status: 'EXPIRED' },
      });
      const matches = await this.prisma.routeMatch.updateMany({
        where: {
          status: 'SUGGESTED',
          OR: [
            { request: { status: { notIn: ['PUBLISHED', 'IN_PROPOSALS'] } } },
            { route: { status: { not: 'ACTIVE' } } },
          ],
        },
        data: { status: 'EXPIRED' },
      });
      if (routes.count || matches.count) {
        this.logger.log(`Vencidas: ${routes.count} rutas, ${matches.count} coincidencias`);
      }
      return { routes: routes.count, matches: matches.count };
    } catch (err) {
      this.logger.error(`expireDue falló: ${(err as Error).message}`);
      return { routes: 0, matches: 0 };
    } finally {
      this.running = false;
    }
  }
}
