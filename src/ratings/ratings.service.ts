import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { CRITERIA, RATING_WINDOW_DAYS, RatingRole, ratingDeadline, recomputeReputation } from './reputation';

@Injectable()
export class RatingsService {
  private readonly logger = new Logger(RatingsService.name);
  private revealing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Crear una evaluación (doble vía). Los criterios dependen del rol del
   * evaluado. Es a ciegas: el evaluado no la ve hasta que ambas partes
   * califiquen o venza la ventana de RATING_WINDOW_DAYS días.
   */
  async create(userId: string, dto: CreateRatingDto) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const contract = await this.prisma.serviceContract.findUnique({ where: { id: dto.contractId } });
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    if (!['COMPLETED', 'EVALUATED'].includes(contract.status)) {
      throw new BadRequestException('El servicio debe estar completado para poder evaluar');
    }
    const deadline = ratingDeadline(contract.completedAt);
    if (deadline && deadline.getTime() < Date.now()) {
      throw new BadRequestException(`El plazo para calificar (${RATING_WINDOW_DAYS} días) ya venció`);
    }

    // La otra parte y su rol en el contrato
    let targetId: string;
    let targetRole: RatingRole;
    if (contract.requesterId === profile.id) {
      targetId = contract.providerId;
      targetRole = 'PROVIDER';
    } else if (contract.providerId === profile.id) {
      targetId = contract.requesterId;
      targetRole = 'REQUESTER';
    } else {
      throw new BadRequestException('No eres parte de este contrato');
    }

    const existing = await this.prisma.rating.findUnique({
      where: { contractId_authorId: { contractId: dto.contractId, authorId: profile.id } },
    });
    if (existing) throw new ConflictException('Ya evaluaste este servicio');

    // Solo se guardan los criterios del rol evaluado
    const criteria: Record<string, number> = {};
    for (const key of CRITERIA[targetRole]) {
      const v = (dto as any)[key];
      if (typeof v === 'number') criteria[key] = v;
    }

    const rating = await this.prisma.rating.create({
      data: {
        contractId: dto.contractId,
        authorId: profile.id,
        targetId,
        targetRole,
        score: dto.score,
        comment: dto.comment?.trim() || null,
        wouldRepeat: typeof dto.wouldRepeat === 'boolean' ? dto.wouldRepeat : null,
        ...criteria,
      },
    });

    const count = await this.prisma.rating.count({ where: { contractId: dto.contractId } });
    if (count >= 2) {
      await this.prisma.serviceContract.update({ where: { id: dto.contractId }, data: { status: 'EVALUATED' } });
      // Propagar al ServiceRequest: ciclo finalizado (ambos evaluaron).
      await this.prisma.serviceRequest.update({
        where: { id: contract.requestId },
        data: { status: 'EVALUATED' },
      }).catch(() => undefined);
      await this.revealContract(dto.contractId);
    } else {
      // Sin las estrellas: la evaluación sigue oculta hasta que la otra parte califique
      await this.notifications.notify({
        profileId: targetId,
        type: 'NEW_RATING',
        title: 'Recibiste una evaluación',
        body: `${profile.displayName} ya te calificó. Califícalo tú también para ver su evaluación.`,
        entityType: 'contract',
        entityId: dto.contractId,
      });
    }

    return rating;
  }

  /**
   * Revela las evaluaciones ocultas de un contrato, recalcula la reputación de
   * los evaluados y les avisa. Idempotente: si otra llamada ya las reveló, no
   * hace nada.
   */
  async revealContract(contractId: string, now = new Date()) {
    const hidden = await this.prisma.rating.findMany({
      where: { contractId, revealedAt: null },
      include: { author: { select: { displayName: true } } },
    });
    if (!hidden.length) return;

    const { count } = await this.prisma.rating.updateMany({
      where: { id: { in: hidden.map((r) => r.id) }, revealedAt: null },
      data: { revealedAt: now },
    });
    if (!count) return;

    for (const r of hidden) {
      await recomputeReputation(this.prisma, r.targetId);
      await this.notifications.notify({
        profileId: r.targetId,
        type: 'RATING_REVEALED',
        title: 'Ya puedes ver tu evaluación',
        body: `${r.author.displayName} te calificó con ${r.score} estrella(s).`,
        entityType: 'contract',
        entityId: contractId,
      });
    }
  }

  /** Vencida la ventana, se revelan las evaluaciones aunque la otra parte no haya calificado. */
  @Cron('15 * * * *')
  async revealExpired(now = new Date()): Promise<number> {
    if (this.revealing) return 0;
    this.revealing = true;
    try {
      const cutoff = new Date(now.getTime() - RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const due = await this.prisma.rating.findMany({
        where: { revealedAt: null, contract: { completedAt: { lt: cutoff } } },
        select: { contractId: true },
        distinct: ['contractId'],
      });
      for (const { contractId } of due) {
        await this.revealContract(contractId, now);
      }
      if (due.length) this.logger.log(`Evaluaciones reveladas por vencimiento: ${due.length} contrato(s)`);
      return due.length;
    } catch (err) {
      this.logger.error('revealExpired failed', err as any);
      return 0;
    } finally {
      this.revealing = false;
    }
  }

  /** Evaluaciones reveladas de un perfil, opcionalmente solo las de un rol. */
  async findByProfile(profileId: string, role?: string) {
    const targetRole = role === 'PROVIDER' || role === 'REQUESTER' ? role : undefined;
    return this.prisma.rating.findMany({
      where: { targetId: profileId, revealedAt: { not: null }, ...(targetRole ? { targetRole } : {}) },
      include: { author: { select: { displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}
