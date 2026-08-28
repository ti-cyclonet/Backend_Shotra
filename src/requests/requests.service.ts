import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequestDto } from './dto/create-request.dto';

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

    // Expiración por defecto: 48h (o 24h si urgente)
    const hoursToExpire = dto.isUrgent ? 24 : 48;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + hoursToExpire);

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
        isRemote: dto.isRemote || false,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        isUrgent: dto.isUrgent || false,
        expiresAt,
        status: 'PUBLISHED',
      },
      include: { category: true, requester: { select: { displayName: true, avatarUrl: true, averageRating: true } } },
    });
  }

  /** Listar solicitudes publicadas (para ofertantes) — filtradas por categoría y cercanía */
  async findPublished(filters: { categorySlug?: string; lat?: number; lng?: number; radiusKm?: number }) {
    const where: any = { status: 'PUBLISHED' };

    if (filters.categorySlug) {
      where.category = { slug: filters.categorySlug };
    }

    const requests = await this.prisma.serviceRequest.findMany({
      where,
      include: {
        category: true,
        requester: { select: { displayName: true, avatarUrl: true, averageRating: true, city: true } },
        _count: { select: { proposals: true } },
      },
      orderBy: [{ isUrgent: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });

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

    return this.prisma.serviceRequest.findMany({
      where: { requesterId: profile.id },
      include: {
        category: true,
        _count: { select: { proposals: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Detalle de una solicitud con propuestas */
  async findOne(requestId: string) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      include: {
        category: true,
        requester: { select: { id: true, displayName: true, avatarUrl: true, averageRating: true, city: true } },
        proposals: {
          include: {
            provider: { select: { id: true, displayName: true, avatarUrl: true, averageRating: true, completedJobs: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!request) throw new NotFoundException('Solicitud no encontrada');
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
}
