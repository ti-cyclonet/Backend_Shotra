import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRatingDto } from './dto/create-rating.dto';

@Injectable()
export class RatingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Crear una evaluación (doble vía: solicitante evalúa ofertante y viceversa) */
  async create(userId: string, dto: CreateRatingDto) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const contract = await this.prisma.serviceContract.findUnique({ where: { id: dto.contractId } });
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    if (!['COMPLETED', 'EVALUATED'].includes(contract.status)) {
      throw new BadRequestException('El servicio debe estar completado para poder evaluar');
    }

    // Determinar quién es el target (la otra parte)
    let targetId: string;
    if (contract.requesterId === profile.id) {
      targetId = contract.providerId; // solicitante evalúa al ofertante
    } else if (contract.providerId === profile.id) {
      targetId = contract.requesterId; // ofertante evalúa al solicitante
    } else {
      throw new BadRequestException('No eres parte de este contrato');
    }

    // Verificar que no haya evaluado ya
    const existing = await this.prisma.rating.findUnique({
      where: { contractId_authorId: { contractId: dto.contractId, authorId: profile.id } },
    });
    if (existing) throw new ConflictException('Ya evaluaste este servicio');

    // Crear el rating
    const rating = await this.prisma.rating.create({
      data: {
        contractId: dto.contractId,
        authorId: profile.id,
        targetId,
        score: dto.score,
        comment: dto.comment,
        quality: dto.quality,
        punctuality: dto.punctuality,
        communication: dto.communication,
      },
    });

    // Recalcular el promedio del target
    const allRatings = await this.prisma.rating.findMany({ where: { targetId } });
    const avgScore = allRatings.reduce((sum, r) => sum + r.score, 0) / allRatings.length;

    await this.prisma.userProfile.update({
      where: { id: targetId },
      data: { averageRating: Math.round(avgScore * 10) / 10, totalRatings: allRatings.length },
    });

    // Si ambos evaluaron, marcar el contrato como EVALUATED
    const bothRated = await this.prisma.rating.count({ where: { contractId: dto.contractId } });
    if (bothRated >= 2) {
      await this.prisma.serviceContract.update({
        where: { id: dto.contractId },
        data: { status: 'EVALUATED' },
      });

      // Incrementar completedJobs del proveedor
      await this.prisma.userProfile.update({
        where: { id: contract.providerId },
        data: { completedJobs: { increment: 1 } },
      });
    }

    return rating;
  }

  /** Ver ratings de un perfil */
  async findByProfile(profileId: string) {
    return this.prisma.rating.findMany({
      where: { targetId: profileId },
      include: { author: { select: { displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}
