import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { computeExpiresAt, expiryConfig, expiryReason } from './request-expiry';
import {
  PROVIDER_REPUTATION_SELECT,
  REQUESTER_REPUTATION_SELECT,
  providerReputation,
  requesterReputation,
} from '../ratings/reputation';

/** Adjunta el resumen de reputación (insignias, criterios, % recontratación). */
function withProviderReputation<T extends Parameters<typeof providerReputation>[0]>(p: T | null) {
  return p ? { ...p, reputation: providerReputation(p) } : p;
}
function withRequesterReputation<T extends Parameters<typeof requesterReputation>[0]>(p: T | null) {
  return p ? { ...p, reputation: requesterReputation(p) } : p;
}

/** Ofertas vigentes: se cuentan aparte de las rechazadas o retiradas. */
const PENDING_COUNT = { proposals: { where: { status: 'PENDING' as const } } };

/**
 * Hasta cuándo sigue abierta una publicación (para mostrar "vence en…"):
 * sin ofertas, su expiresAt; con ofertas, el plazo máximo para elegir; y
 * nunca después de la fecha de servicio.
 */
function closesAt(r: { createdAt: Date; expiresAt: Date | null; scheduledAt: Date | null }, pending: number): Date | null {
  const cfg = expiryConfig();
  let at = pending > 0 ? r.createdAt.getTime() + cfg.maxOpenDays * 864e5 : r.expiresAt?.getTime() ?? null;
  if (r.scheduledAt) {
    const limit = r.scheduledAt.getTime() + cfg.scheduleGraceHours * 36e5;
    at = at === null ? limit : Math.min(at, limit);
  }
  return at === null ? null : new Date(at);
}

@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Crear una solicitud de servicio */
  async create(userId: string, dto: CreateRequestDto) {
    // Obtener el perfil del solicitante
    const profile = await this.prisma.userProfile.findUnique({
      where: { authorizaUserId: userId },
    });
    if (!profile) throw new BadRequestException('Debes completar tu perfil antes de crear una solicitud');

    // Verificar que la categoría existe
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    // Vence si no recibe ofertas: 48 h (24 h si es urgente) y nunca después
    // de la fecha de servicio (ver request-expiry.ts)
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (scheduledAt && scheduledAt.getTime() < Date.now() - 5 * 60 * 1000) {
      throw new BadRequestException('La fecha del servicio ya pasó. Elige una fecha futura.');
    }
    const expiresAt = computeExpiresAt(new Date(), !!dto.isUrgent, scheduledAt);

    return this.prisma.serviceRequest.create({
      data: {
        requesterId: profile.id,
        categoryId: dto.categoryId,
        title: dto.title,
        description: dto.description,
        budgetMin: dto.budgetMin,
        budgetMax: dto.budgetMax,
        latitude: dto.latitude,
        longitude: dto.longitude,
        address: dto.address,
        originLatitude: dto.originLatitude,
        originLongitude: dto.originLongitude,
        originAddress: dto.originAddress,
        isRemote: dto.isRemote || false,
        scheduledAt,
        isUrgent: dto.isUrgent || false,
        expiresAt,
        status: 'PUBLISHED',
      },
      include: { category: true, requester: { select: { displayName: true, avatarUrl: true, averageRating: true } } },
    });
  }

  /** Listar solicitudes publicadas (para ofertantes) — filtradas por categoría y cercanía */
  async findPublished(filters: { categorySlug?: string; lat?: number; lng?: number; radiusKm?: number }) {
    // El feed "Explorar servicios" solo muestra solicitudes ABIERTAS (que aún
    // aceptan propuestas): PUBLISHED (sin ofertas aún) e IN_PROPOSALS (ya con
    // ofertas, pero abierta). Se EXCLUYEN las que ya no reciben ofertas:
    // ACCEPTED, IN_PROGRESS, PENDING_CONFIRMATION, COMPLETED, EVALUATED,
    // CANCELLED, EXPIRED, DRAFT.
    const where: any = { status: { in: ['PUBLISHED', 'IN_PROPOSALS'] } };

    if (filters.categorySlug) {
      where.category = { slug: filters.categorySlug };
    }

    const raw = await this.prisma.serviceRequest.findMany({
      where,
      include: {
        category: true,
        requester: { select: { displayName: true, avatarUrl: true, averageRating: true, city: true, ...REQUESTER_REPUTATION_SELECT } },
        _count: { select: { proposals: true } },
        proposals: { where: { status: 'PENDING' }, select: { id: true } },
      },
      orderBy: [{ isUrgent: 'desc' }, { createdAt: 'desc' }],
      take: 80,
    });
    // Las vencidas salen del feed al instante (el cron las archiva cada 10 min)
    const now = new Date();
    const requests = raw
      .filter((r) => !expiryReason({ ...r, pendingProposals: r.proposals.length }, now))
      .slice(0, 50)
      .map(({ proposals, ...r }) => ({
        ...r,
        requester: withRequesterReputation(r.requester),
        closesAt: closesAt(r, proposals.length),
      }));

    // Si hay coordenadas, calcular distancia y filtrar
    if (filters.lat && filters.lng) {
      const R = 6371;
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const radiusKm = filters.radiusKm || 15;

      return requests
        .filter((r) => r.latitude && r.longitude)
        .map((r) => {
          const dLat = toRad(r.latitude! - filters.lat!);
          const dLng = toRad(r.longitude! - filters.lng!);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(filters.lat!)) * Math.cos(toRad(r.latitude!)) * Math.sin(dLng / 2) ** 2;
          const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return { ...r, distance: Math.round(distance * 10) / 10 };
        })
        .filter((r) => r.distance <= radiusKm)
        .sort((a, b) => a.distance - b.distance);
    }

    return requests;
  }

  /** Mis solicitudes (como solicitante) */
  async findMyRequests(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { authorizaUserId: userId },
    });
    if (!profile) return [];

    const list = await this.prisma.serviceRequest.findMany({
      where: { requesterId: profile.id },
      include: {
        category: true,
        _count: { select: { proposals: true } },
        proposals: { where: { status: 'PENDING' }, select: { id: true } },
        // Incluir el contrato (si existe) para que el cliente pueda mostrar el
        // estado REAL del ciclo (firmado, completado, evaluado) aunque el
        // request.status vaya un paso atrás.
        contract: { select: { id: true, code: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // closesAt: hasta cuándo sigue abierta; expiredNow: ya venció aunque el
    // cron aún no la haya archivado (la app la muestra como vencida)
    const now = new Date();
    return list.map(({ proposals, ...r }) => ({
      ...r,
      pendingProposals: proposals.length,
      closesAt: ['PUBLISHED', 'IN_PROPOSALS'].includes(r.status) ? closesAt(r, proposals.length) : null,
      expiredNow: !!expiryReason({ ...r, pendingProposals: proposals.length }, now),
    }));
  }

  /** Detalle de una solicitud con propuestas */
  /**
   * Detalle de una solicitud. Las propuestas son privadas: el solicitante ve
   * todas; un ofertante solo ve la suya (antes cada ofertante veía el precio,
   * el mensaje y el estado de las ofertas de los demás).
   */
  async findOne(requestId: string, viewerUserId?: string) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      include: {
        category: true,
        requester: { select: { id: true, displayName: true, avatarUrl: true, averageRating: true, city: true, ...REQUESTER_REPUTATION_SELECT } },
        proposals: {
          include: {
            provider: {
              select: { id: true, displayName: true, avatarUrl: true, averageRating: true, ...PROVIDER_REPUTATION_SELECT },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        // requesterSignedAt/providerSignedAt/providerId: el cliente los usa
        // para saber si ya puede mostrar el botón de Chat (solo tras la firma
        // de ambas partes) y si el usuario en sesión es el ofertante firmante.
        contract: { select: { id: true, code: true, status: true, requesterSignedAt: true, providerSignedAt: true, providerId: true } },
      },
    });
    if (!request) throw new NotFoundException('Solicitud no encontrada');

    const viewer = viewerUserId
      ? await this.prisma.userProfile.findUnique({ where: { authorizaUserId: viewerUserId }, select: { id: true } })
      : null;
    const isRequester = !!viewer && viewer.id === request.requesterId;
    const proposalsCount = request.proposals.length;
    if (!isRequester) {
      (request as any).proposals = request.proposals.filter((p) => viewer && p.providerId === viewer.id);
    }
    (request as any).isRequester = isRequester;
    (request as any).proposalsCount = proposalsCount;
    const pending = request.proposals.filter((p) => p.status === 'PENDING').length;
    (request as any).closesAt = ['PUBLISHED', 'IN_PROPOSALS'].includes(request.status) ? closesAt(request, pending) : null;
    (request as any).expiredNow = !!expiryReason({ ...request, pendingProposals: pending }, new Date());

    // Resolver las fotos elegidas por cada propuesta (imageIds no es una
    // relación de Prisma, así que se resuelven aparte en una sola consulta).
    const allImageIds = [...new Set(request.proposals.flatMap((p) => p.imageIds || []))];
    if (allImageIds.length > 0) {
      const images = await this.prisma.portfolioItem.findMany({
        where: { id: { in: allImageIds } },
        select: { id: true, imageUrl: true, title: true },
      });
      const byId = new Map(images.map((img) => [img.id, img]));
      (request as any).proposals = request.proposals.map((p) => ({
        ...p,
        images: (p.imageIds || []).map((id) => byId.get(id)).filter(Boolean),
      }));
    } else {
      (request as any).proposals = request.proposals.map((p) => ({ ...p, images: [] }));
    }

    // Reputación del ofertante (como ofertante) y orden recomendado: primero las
    // pendientes, y entre ellas por promedio bayesiano (no por la que llegó antes).
    const ranked = ((request as any).proposals as any[])
      .map((p) => ({ ...p, provider: withProviderReputation(p.provider) }))
      .sort((a, b) => {
        const pa = a.status === 'PENDING' ? 0 : 1;
        const pb = b.status === 'PENDING' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return (b.provider?.reputation?.score ?? 0) - (a.provider?.reputation?.score ?? 0);
      });
    // "Recomendada": la mejor pendiente, solo si su ofertante ya tiene evaluaciones
    const top = ranked[0];
    if (top && top.status === 'PENDING' && (top.provider?.reputation?.count ?? 0) > 0 && ranked.filter((p) => p.status === 'PENDING').length > 1) {
      top.recommended = true;
    }
    (request as any).proposals = ranked;
    (request as any).requester = withRequesterReputation(request.requester);

    return request;
  }

  /** Cancelar una solicitud (solo el solicitante) */
  async cancel(userId: string, requestId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const request = await this.prisma.serviceRequest.findFirst({
      where: { id: requestId, requesterId: profile.id },
    });
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    if (!['PUBLISHED', 'IN_PROPOSALS', 'DRAFT'].includes(request.status)) {
      throw new BadRequestException('No se puede cancelar una solicitud en este estado');
    }

    return this.prisma.serviceRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * Volver a publicar una solicitud vencida: queda abierta de nuevo con un
   * plazo nuevo. Si tenía fecha de servicio y ya pasó, hay que elegir otra.
   */
  async republish(userId: string, requestId: string, scheduledAtIso?: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');
    const request = await this.prisma.serviceRequest.findFirst({
      where: { id: requestId, requesterId: profile.id },
      include: { contract: { select: { id: true } }, proposals: { where: { status: 'PENDING' }, select: { id: true } } },
    });
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    // Vencida: archivada por el cron o ya pasada de plazo (el cron corre cada 10 min)
    const expired = request.status === 'EXPIRED' || !!expiryReason({ ...request, pendingProposals: request.proposals.length });
    if (!expired || request.contract) {
      throw new BadRequestException('Solo se puede volver a publicar una solicitud vencida.');
    }
    if (request.proposals.length) {
      await this.prisma.proposal.updateMany({ where: { requestId, status: 'PENDING' }, data: { status: 'REJECTED' } });
    }

    let scheduledAt: Date | null = scheduledAtIso ? new Date(scheduledAtIso) : request.scheduledAt;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new BadRequestException('Fecha inválida.');
    if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
      if (scheduledAtIso) throw new BadRequestException('La nueva fecha debe ser futura.');
      throw new BadRequestException({ code: 'NEW_DATE_REQUIRED', message: 'La fecha que habías pedido ya pasó. Elige una nueva fecha para volver a publicarla.' });
    }

    return this.prisma.serviceRequest.update({
      where: { id: requestId },
      data: {
        status: 'PUBLISHED',
        scheduledAt,
        // Vuelve a aparecer arriba en el feed, con un plazo completo
        createdAt: new Date(),
        expiresAt: computeExpiresAt(new Date(), request.isUrgent, scheduledAt),
      },
      include: { category: true },
    });
  }
}
