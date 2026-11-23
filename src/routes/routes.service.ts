import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OsrmClient } from './osrm.client';
import { RouteMatcherService } from './route-matcher.service';
import { CoverageQueryDto, CreateRouteDto } from './dto/create-route.dto';
import { DETOUR_PRESETS, activeRouteLimit, departAtValid, etaAt, fitsPackage, timeWindowOk, PackageSize } from './route-rules';

@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly osrm: OsrmClient,
    private readonly matcher: RouteMatcherService,
  ) {}

  private async profileOf(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new BadRequestException('Debes completar tu perfil');
    return profile;
  }

  private async ownRoute(userId: string, routeId: string) {
    const profile = await this.profileOf(userId);
    const route = await this.prisma.providerRoute.findUnique({ where: { id: routeId } });
    if (!route) throw new NotFoundException('Ruta no encontrada');
    if (route.providerId !== profile.id) throw new ForbiddenException('Esta ruta no es tuya');
    return { profile, route };
  }

  /** Publicar un trayecto que el ofertante ya va a hacer. */
  async create(userId: string, dto: CreateRouteDto) {
    const profile = await this.profileOf(userId);
    if (!profile.isProvider) throw new BadRequestException('Debes activar tu perfil como ofertante');

    // Solo quien ofrece domicilios (alguna categoría con trayecto)
    const deliverySkill = await this.prisma.providerSkill.findFirst({
      where: { profileId: profile.id, category: { requiresRoute: true } },
      select: { id: true },
    });
    if (!deliverySkill) {
      throw new BadRequestException('Agrega a tu perfil una habilidad de domicilios para publicar rutas.');
    }

    const limit = activeRouteLimit(profile.plan);
    const active = await this.prisma.providerRoute.count({
      where: { providerId: profile.id, status: 'ACTIVE', arriveAt: { gt: new Date() } },
    });
    if (active >= limit) {
      throw new BadRequestException(
        limit === 1
          ? 'Ya tienes una ruta activa. Ciérrala o cancélala para publicar otra (con el plan PRO puedes tener 3).'
          : `Ya tienes ${active} rutas activas, el máximo de tu plan.`,
      );
    }

    const departAt = dto.departAt ? new Date(dto.departAt) : new Date();
    if (!departAtValid(departAt)) {
      throw new BadRequestException('La hora de salida debe ser desde ahora y hasta 7 días adelante.');
    }

    const origin = { lat: dto.originLatitude, lng: dto.originLongitude };
    const dest = { lat: dto.destLatitude, lng: dto.destLongitude };
    const osrm = await this.osrm.route([origin, dest], { geometry: true, timeoutMs: 6000 });
    if (!osrm || osrm.geometry.coordinates.length < 2) {
      throw new ServiceUnavailableException('No pudimos trazar la ruta por calles. Intenta de nuevo en un momento.');
    }
    if (osrm.distanceM < 300) throw new BadRequestException('El origen y el destino están demasiado cerca.');

    const preset = DETOUR_PRESETS[dto.detour || 'MEDIUM'];
    const route = await this.prisma.$transaction(async (tx) => {
      const created = await tx.providerRoute.create({
        data: {
          providerId: profile.id,
          originLatitude: origin.lat,
          originLongitude: origin.lng,
          originAddress: dto.originAddress?.trim() || null,
          destLatitude: dest.lat,
          destLongitude: dest.lng,
          destAddress: dto.destAddress?.trim() || null,
          distanceM: osrm.distanceM,
          durationS: osrm.durationS,
          departAt,
          arriveAt: new Date(departAt.getTime() + osrm.durationS * 1000),
          corridorM: preset.corridorM,
          maxDetourM: preset.maxDetourM,
          maxDetourS: preset.maxDetourS,
          maxPackageSize: dto.maxPackageSize || 'SMALL',
          maxOrders: dto.maxOrders ?? 3,
        },
      });
      await tx.$executeRaw`
        UPDATE provider_routes
        SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(osrm.geometry)}), 4326)::geography
        WHERE id = ${created.id}`;
      return created;
    });

    const matches = await this.matcher.matchRoute(route.id);
    return { ...route, geometry: osrm.geometry, matchesCount: matches };
  }

  /** Mis rutas: activas primero, con cuántos pedidos tienen encima. */
  async mine(userId: string) {
    const profile = await this.profileOf(userId);
    const routes = await this.prisma.providerRoute.findMany({
      where: { providerId: profile.id },
      orderBy: [{ status: 'asc' }, { departAt: 'desc' }],
      take: 30,
      include: { _count: { select: { matches: { where: { status: 'SUGGESTED' } } } } },
    });
    return routes.map(({ _count, ...r }) => ({ ...r, matchesCount: _count.matches }));
  }

  /** Detalle con la geometría (GeoJSON) para dibujarla. Solo el dueño. */
  async detail(userId: string, routeId: string) {
    const { route } = await this.ownRoute(userId, routeId);
    const [geo] = await this.prisma.$queryRaw<{ geojson: string | null }[]>`
      SELECT ST_AsGeoJSON(geom) AS geojson FROM provider_routes WHERE id = ${routeId}`;
    return { ...route, geometry: geo?.geojson ? JSON.parse(geo.geojson) : null };
  }

  /** Pedidos que caen en la ruta (vigentes), con desvío y hora estimada de recogida. */
  async matches(userId: string, routeId: string) {
    const { profile } = await this.ownRoute(userId, routeId);
    const list = await this.prisma.routeMatch.findMany({
      where: { routeId, status: { in: ['SUGGESTED', 'PROPOSED'] } },
      orderBy: [{ status: 'asc' }, { etaPickupAt: 'asc' }],
      include: {
        request: {
          select: {
            id: true, title: true, description: true, status: true,
            budgetMin: true, budgetMax: true, currency: true,
            address: true, latitude: true, longitude: true,
            originAddress: true, originLatitude: true, originLongitude: true,
            scheduledAt: true, isUrgent: true, packageSize: true, expiresAt: true,
            category: { select: { id: true, name: true, slug: true, icon: true } },
            requester: { select: { displayName: true, avatarUrl: true, requesterRating: true, requesterRatingCount: true } },
            proposals: { where: { providerId: profile.id }, select: { id: true, status: true, price: true } },
          },
        },
      },
    });
    return list.map((m) => {
      const { proposals, ...request } = m.request;
      return { ...m, request, myProposal: proposals[0] ?? null };
    });
  }

  async dismiss(userId: string, routeId: string, matchId: string) {
    await this.ownRoute(userId, routeId);
    const match = await this.prisma.routeMatch.findFirst({ where: { id: matchId, routeId } });
    if (!match) throw new NotFoundException('Coincidencia no encontrada');
    if (match.status !== 'SUGGESTED') throw new BadRequestException('Este pedido ya no está sugerido.');
    return this.prisma.routeMatch.update({ where: { id: matchId }, data: { status: 'DISMISSED' } });
  }

  /** Cerrar (ya llegó) o cancelar la ruta. No afecta contratos ya firmados. */
  async close(userId: string, routeId: string, status: 'COMPLETED' | 'CANCELLED') {
    const { route } = await this.ownRoute(userId, routeId);
    if (route.status !== 'ACTIVE') throw new BadRequestException('La ruta ya no está activa.');
    const [updated] = await this.prisma.$transaction([
      this.prisma.providerRoute.update({ where: { id: routeId }, data: { status } }),
      this.prisma.routeMatch.updateMany({ where: { routeId, status: 'SUGGESTED' }, data: { status: 'EXPIRED' } }),
    ]);
    return updated;
  }

  /**
   * Para el solicitante, antes de publicar: cuántos ofertantes distintos pasan
   * por su recogida y entrega a una hora compatible. Nunca devuelve rutas ni
   * ubicaciones de ofertantes, solo el conteo.
   */
  async coverage(userId: string, q: CoverageQueryDto) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId }, select: { id: true } });
    const rows = await this.matcher.candidateRoutes({
      pickup: { lat: q.pickLat, lng: q.pickLng },
      dropoff: { lat: q.dropLat, lng: q.dropLng },
      excludeProfileId: profile?.id,
      categoryId: q.categoryId,
      limit: 50,
    });
    const scheduledAt = q.at ? new Date(q.at) : null;
    const now = new Date();
    const providers = new Set(
      rows
        .filter((r) => fitsPackage(q.packageSize as PackageSize | undefined, r.maxPackageSize))
        .filter((r) =>
          timeWindowOk(
            { scheduledAt, isUrgent: q.urgent === 'true', expiresAt: null },
            etaAt(r.departAt, r.durationS, r.pickupFraction),
            now,
          ),
        )
        .map((r) => r.providerId),
    );
    return { count: providers.size };
  }
}
