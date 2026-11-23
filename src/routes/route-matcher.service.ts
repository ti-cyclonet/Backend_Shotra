import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OsrmClient } from './osrm.client';
import {
  PackageSize,
  ROUTE_BUSY_CONTRACT,
  canPush,
  detourLabel,
  detourOk,
  etaAt,
  fitsPackage,
  timeWindowOk,
} from './route-rules';

/** Ruta candidata devuelta por el filtro espacial. */
interface RouteRow {
  id: string;
  providerId: string;
  departAt: Date;
  durationS: number;
  distanceM: number;
  maxDetourM: number;
  maxDetourS: number;
  maxPackageSize: PackageSize;
  maxOrders: number;
  lastPushAt: Date | null;
  originLatitude: number;
  originLongitude: number;
  destLatitude: number;
  destLongitude: number;
  pickupFraction: number;
  dropoffFraction: number;
  offM: number;
}

/** Solicitud vista desde el matcher (con recogida y entrega). */
interface RequestRow {
  id: string;
  title: string;
  requesterId: string;
  scheduledAt: Date | null;
  isUrgent: boolean;
  expiresAt: Date | null;
  packageSize: PackageSize | null;
  originLatitude: number;
  originLongitude: number;
  latitude: number;
  longitude: number;
}

interface Evaluated {
  pickupFraction: number;
  dropoffFraction: number;
  detourM: number | null;
  detourS: number | null;
  etaPickupAt: Date;
}

/** Candidatos que pasan a OSRM (desvío real) por cada cruce. */
const OSRM_TOP = 5;

const point = (lat: number, lng: number) =>
  Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)`;

/**
 * Cruza solicitudes de domicilio con rutas publicadas por ofertantes.
 *
 * 1. PostGIS: la recogida y la entrega quedan dentro del corredor de la ruta y
 *    la recogida va antes que la entrega (ST_LineLocatePoint).
 * 2. Reglas de negocio (route-rules.ts): tamaño, ventana de tiempo, cupo.
 * 3. OSRM para los mejores candidatos: desvío real por calles.
 *
 * Nunca lanza hacia quien lo llama: un fallo aquí no debe impedir publicar
 * una solicitud ni crear una ruta.
 */
@Injectable()
export class RouteMatcherService {
  private readonly logger = new Logger(RouteMatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly osrm: OsrmClient,
  ) {}

  // ─── Filtro espacial ─────────────────────────────────────────────────────

  /** Rutas activas cuyo corredor contiene recogida y entrega, en ese orden. */
  async candidateRoutes(input: {
    pickup: { lat: number; lng: number };
    dropoff: { lat: number; lng: number };
    excludeProfileId?: string;
    categoryId?: string;
    limit?: number;
  }): Promise<RouteRow[]> {
    const pick = point(input.pickup.lat, input.pickup.lng);
    const drop = point(input.dropoff.lat, input.dropoff.lng);
    const exclude = input.excludeProfileId
      ? Prisma.sql`AND r."providerId" <> ${input.excludeProfileId}`
      : Prisma.empty;
    const skill = input.categoryId
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM provider_skills s WHERE s."profileId" = r."providerId" AND s."categoryId" = ${input.categoryId})`
      : Prisma.empty;
    return this.prisma.$queryRaw<RouteRow[]>`
      SELECT r.id, r."providerId", r."departAt", r."durationS", r."distanceM",
             r."maxDetourM", r."maxDetourS", r."maxPackageSize"::text AS "maxPackageSize",
             r."maxOrders", r."lastPushAt",
             r."originLatitude", r."originLongitude", r."destLatitude", r."destLongitude",
             ST_LineLocatePoint(r.geom::geometry, ${pick}) AS "pickupFraction",
             ST_LineLocatePoint(r.geom::geometry, ${drop}) AS "dropoffFraction",
             ST_Distance(r.geom, ${pick}::geography) + ST_Distance(r.geom, ${drop}::geography) AS "offM"
      FROM provider_routes r
      WHERE r.status = 'ACTIVE'
        AND r.geom IS NOT NULL
        AND r."arriveAt" > now()
        ${exclude}
        ${skill}
        AND ST_DWithin(r.geom, ${pick}::geography, r."corridorM")
        AND ST_DWithin(r.geom, ${drop}::geography, r."corridorM")
        AND ST_LineLocatePoint(r.geom::geometry, ${pick}) < ST_LineLocatePoint(r.geom::geometry, ${drop})
      ORDER BY "offM" ASC
      LIMIT ${input.limit ?? 20}`;
  }

  // ─── Evaluación ──────────────────────────────────────────────────────────

  /** Reglas baratas (sin red): tamaño y ventana de tiempo. */
  private quickCheck(route: RouteRow, req: RequestRow, now: Date): Evaluated | null {
    if (!fitsPackage(req.packageSize, route.maxPackageSize)) return null;
    const etaPickupAt = etaAt(route.departAt, route.durationS, route.pickupFraction);
    if (!timeWindowOk(req, etaPickupAt, now)) return null;
    return {
      pickupFraction: route.pickupFraction,
      dropoffFraction: route.dropoffFraction,
      detourM: null,
      detourS: null,
      etaPickupAt,
    };
  }

  /** Desvío real: origen → recogida → entrega → destino, contra la ruta base. */
  private async withDetour(route: RouteRow, req: RequestRow, ev: Evaluated): Promise<Evaluated | null> {
    const via = await this.osrm.route([
      { lat: route.originLatitude, lng: route.originLongitude },
      { lat: req.originLatitude, lng: req.originLongitude },
      { lat: req.latitude, lng: req.longitude },
      { lat: route.destLatitude, lng: route.destLongitude },
    ]);
    if (!via) return ev; // OSRM caído: se queda el filtro geométrico
    const detourM = Math.max(0, via.distanceM - route.distanceM);
    const detourS = Math.max(0, via.durationS - route.durationS);
    if (!detourOk(route, { detourM, detourS })) return null;
    return { ...ev, detourM, detourS };
  }

  /** Rutas sin cupo: ya llevan maxOrders pedidos aceptados sin entregar. */
  private async fullRoutes(routes: { id: string; maxOrders: number }[]): Promise<Set<string>> {
    if (!routes.length) return new Set();
    const busy = await this.prisma.proposal.groupBy({
      by: ['routeId'],
      where: {
        routeId: { in: routes.map((r) => r.id) },
        status: 'ACCEPTED',
        contract: { status: { in: [...ROUTE_BUSY_CONTRACT] } },
      },
      _count: { _all: true },
    });
    const byId = new Map(busy.map((b) => [b.routeId, b._count._all]));
    return new Set(routes.filter((r) => (byId.get(r.id) ?? 0) >= r.maxOrders).map((r) => r.id));
  }

  // ─── Solicitud nueva → rutas ─────────────────────────────────────────────

  /**
   * Al publicar (o volver a publicar) una solicitud de domicilio: busca las
   * rutas que la contienen, guarda las coincidencias y avisa a los ofertantes.
   * Cubre igual las solicitudes que publica InOut (mismo POST /requests).
   */
  async matchRequest(requestId: string): Promise<number> {
    try {
      const req = await this.prisma.serviceRequest.findUnique({
        where: { id: requestId },
        include: { category: { select: { requiresRoute: true } } },
      });
      if (!req || !req.category.requiresRoute) return 0;
      if (!['PUBLISHED', 'IN_PROPOSALS'].includes(req.status)) return 0;
      if (req.originLatitude == null || req.originLongitude == null || req.latitude == null || req.longitude == null) return 0;
      const row: RequestRow = {
        id: req.id,
        title: req.title,
        requesterId: req.requesterId,
        scheduledAt: req.scheduledAt,
        isUrgent: req.isUrgent,
        expiresAt: req.expiresAt,
        packageSize: req.packageSize as PackageSize | null,
        originLatitude: req.originLatitude,
        originLongitude: req.originLongitude,
        latitude: req.latitude,
        longitude: req.longitude,
      };

      const candidates = await this.candidateRoutes({
        pickup: { lat: row.originLatitude, lng: row.originLongitude },
        dropoff: { lat: row.latitude, lng: row.longitude },
        excludeProfileId: req.requesterId,
        categoryId: req.categoryId,
      });
      if (!candidates.length) return 0;

      // Ya cruzadas (no se repite el aviso) y ofertantes que ya ofertaron
      const [existing, proposed, full] = await Promise.all([
        this.prisma.routeMatch.findMany({ where: { requestId, routeId: { in: candidates.map((c) => c.id) } }, select: { routeId: true } }),
        this.prisma.proposal.findMany({ where: { requestId, status: { in: ['PENDING', 'ACCEPTED'] } }, select: { providerId: true } }),
        this.fullRoutes(candidates),
      ]);
      const seen = new Set(existing.map((e) => e.routeId));
      const proposedBy = new Set(proposed.map((p) => p.providerId));

      const now = new Date();
      const quick = candidates
        .filter((c) => !seen.has(c.id) && !proposedBy.has(c.providerId) && !full.has(c.id))
        .map((c) => ({ route: c, ev: this.quickCheck(c, row, now) }))
        .filter((x): x is { route: RouteRow; ev: Evaluated } => !!x.ev)
        .slice(0, OSRM_TOP);

      const evaluated = await Promise.all(quick.map(async (x) => ({ route: x.route, ev: await this.withDetour(x.route, row, x.ev) })));
      let created = 0;
      for (const { route, ev } of evaluated) {
        if (!ev) continue;
        const match = await this.saveMatch(route.id, requestId, ev);
        if (!match) continue;
        created++;
        await this.pushMatch(route, row, ev, match.id, now);
      }
      return created;
    } catch (err) {
      this.logger.error(`matchRequest(${requestId}) falló: ${(err as Error).message}`);
      return 0;
    }
  }

  private async saveMatch(routeId: string, requestId: string, ev: Evaluated) {
    try {
      return await this.prisma.routeMatch.create({ data: { routeId, requestId, ...ev } });
    } catch (err) {
      // Carrera con otro cruce de la misma pareja (índice único): se ignora
      if ((err as any)?.code === 'P2002') return null;
      throw err;
    }
  }

  private async pushMatch(route: RouteRow, req: RequestRow, ev: Evaluated, matchId: string, now: Date) {
    if (!canPush(route.lastPushAt, now)) return;
    route.lastPushAt = now;
    await this.prisma.providerRoute.update({ where: { id: route.id }, data: { lastPushAt: now } });
    await this.prisma.routeMatch.update({ where: { id: matchId }, data: { notifiedAt: now } });
    const hour = ev.etaPickupAt.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' });
    await this.notifications.notify({
      profileId: route.providerId,
      type: 'ROUTE_MATCH',
      title: 'Pedido en tu ruta',
      body: `"${req.title}": ${detourLabel(ev.detourM, ev.detourS)}, recoges hacia las ${hour}`,
      entityType: 'route',
      entityId: route.id,
    });
  }

  // ─── Ruta nueva → solicitudes ya publicadas ──────────────────────────────

  /**
   * Al crear una ruta: solicitudes abiertas que ya caen en ella. No envía push
   * (el ofertante está en la app viendo su ruta); solo guarda las coincidencias.
   */
  async matchRoute(routeId: string): Promise<number> {
    try {
      const rows = await this.prisma.$queryRaw<(RequestRow & { pickupFraction: number; dropoffFraction: number; offM: number })[]>`
        SELECT q.id, q.title, q."requesterId", q."scheduledAt", q."isUrgent", q."expiresAt",
               q."packageSize"::text AS "packageSize",
               q."originLatitude", q."originLongitude", q.latitude, q.longitude,
               ST_LineLocatePoint(r.geom::geometry, ST_SetSRID(ST_MakePoint(q."originLongitude", q."originLatitude"), 4326)) AS "pickupFraction",
               ST_LineLocatePoint(r.geom::geometry, ST_SetSRID(ST_MakePoint(q.longitude, q.latitude), 4326)) AS "dropoffFraction",
               ST_Distance(r.geom, ST_SetSRID(ST_MakePoint(q."originLongitude", q."originLatitude"), 4326)::geography)
                 + ST_Distance(r.geom, ST_SetSRID(ST_MakePoint(q.longitude, q.latitude), 4326)::geography) AS "offM"
        FROM provider_routes r
        JOIN service_requests q ON true
        JOIN service_categories c ON c.id = q."categoryId"
        WHERE r.id = ${routeId}
          AND r.geom IS NOT NULL
          AND c."requiresRoute" = true
          AND q.status::text IN ('PUBLISHED', 'IN_PROPOSALS')
          AND q."originLatitude" IS NOT NULL AND q."originLongitude" IS NOT NULL
          AND q.latitude IS NOT NULL AND q.longitude IS NOT NULL
          AND q."requesterId" <> r."providerId"
          AND EXISTS (SELECT 1 FROM provider_skills s WHERE s."profileId" = r."providerId" AND s."categoryId" = q."categoryId")
          AND NOT EXISTS (SELECT 1 FROM proposals p WHERE p."requestId" = q.id AND p."providerId" = r."providerId" AND p.status::text IN ('PENDING', 'ACCEPTED'))
          AND NOT EXISTS (SELECT 1 FROM route_matches m WHERE m."routeId" = r.id AND m."requestId" = q.id)
          AND ST_DWithin(r.geom, ST_SetSRID(ST_MakePoint(q."originLongitude", q."originLatitude"), 4326)::geography, r."corridorM")
          AND ST_DWithin(r.geom, ST_SetSRID(ST_MakePoint(q.longitude, q.latitude), 4326)::geography, r."corridorM")
          AND ST_LineLocatePoint(r.geom::geometry, ST_SetSRID(ST_MakePoint(q."originLongitude", q."originLatitude"), 4326))
            < ST_LineLocatePoint(r.geom::geometry, ST_SetSRID(ST_MakePoint(q.longitude, q.latitude), 4326))
        ORDER BY "offM" ASC
        LIMIT 30`;
      if (!rows.length) return 0;

      const route = await this.prisma.providerRoute.findUnique({ where: { id: routeId } });
      if (!route) return 0;
      const base: Omit<RouteRow, 'pickupFraction' | 'dropoffFraction' | 'offM'> = {
        ...route,
        maxPackageSize: route.maxPackageSize as PackageSize,
      };

      const now = new Date();
      const quick = rows
        .map((q) => {
          const r: RouteRow = { ...base, pickupFraction: q.pickupFraction, dropoffFraction: q.dropoffFraction, offM: q.offM };
          return { route: r, req: q, ev: this.quickCheck(r, q, now) };
        })
        .filter((x) => !!x.ev)
        .slice(0, OSRM_TOP * 2);

      let created = 0;
      for (const x of quick) {
        const ev = await this.withDetour(x.route, x.req, x.ev!);
        if (!ev) continue;
        if (await this.saveMatch(routeId, x.req.id, ev)) created++;
      }
      return created;
    } catch (err) {
      this.logger.error(`matchRoute(${routeId}) falló: ${(err as Error).message}`);
      return 0;
    }
  }
}
