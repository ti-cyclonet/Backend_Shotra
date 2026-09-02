import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { ContractsService } from '../contracts/contracts.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contractsService: ContractsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Enviar una propuesta/cotización a una solicitud */
  async create(userId: string, dto: CreateProposalDto) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { authorizaUserId: userId },
    });
    if (!profile) throw new BadRequestException('Debes completar tu perfil');
    if (!profile.isProvider) throw new BadRequestException('Debes activar tu perfil como ofertante');

    // Verificar que la solicitud existe y está abierta
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id: dto.requestId },
    });
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    if (!['PUBLISHED', 'IN_PROPOSALS'].includes(request.status)) {
      throw new BadRequestException('Esta solicitud ya no acepta propuestas');
    }
    // No puedes cotizar tu propia solicitud
    if (request.requesterId === profile.id) {
      throw new BadRequestException('No puedes cotizar tu propia solicitud');
    }

    // Verificar que no haya enviado propuesta ya
    const existing = await this.prisma.proposal.findFirst({
      where: { requestId: dto.requestId, providerId: profile.id, status: { in: ['PENDING', 'ACCEPTED'] } },
    });
    if (existing) throw new ConflictException('Ya enviaste una propuesta a esta solicitud');

    // Crear propuesta
    const proposal = await this.prisma.proposal.create({
      data: {
        requestId: dto.requestId,
        providerId: profile.id,
        price: dto.price,
        description: dto.description,
        estimatedTime: dto.estimatedTime,
        status: 'PENDING',
      },
      include: {
        provider: { select: { displayName: true, avatarUrl: true, averageRating: true, completedJobs: true } },
      },
    });

    // Actualizar estado de la solicitud a IN_PROPOSALS si es la primera propuesta
    if (request.status === 'PUBLISHED') {
      await this.prisma.serviceRequest.update({
        where: { id: dto.requestId },
        data: { status: 'IN_PROPOSALS' },
      });
    }

    // Notificar al solicitante que recibió una propuesta
    await this.notifications.notify({
      profileId: request.requesterId,
      type: 'NEW_PROPOSAL',
      title: 'Nueva propuesta recibida',
      body: `${profile.displayName} envió una propuesta por $${dto.price.toLocaleString()} a "${request.title}"`,
      entityType: 'request',
      entityId: request.id,
    });

    return proposal;
  }

  /** Aceptar una propuesta (solo el solicitante) */
  async accept(userId: string, proposalId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { request: true },
    });
    if (!proposal) throw new NotFoundException('Propuesta no encontrada');
    if (proposal.request.requesterId !== profile.id) {
      throw new BadRequestException('Solo el solicitante puede aceptar propuestas');
    }
    if (proposal.status !== 'PENDING') {
      throw new BadRequestException('Esta propuesta ya no está pendiente');
    }

    // Otras propuestas pendientes que serán rechazadas (para notificar)
    const otherPending = await this.prisma.proposal.findMany({
      where: { requestId: proposal.requestId, id: { not: proposalId }, status: 'PENDING' },
      select: { providerId: true },
    });

    // Aceptar esta propuesta y rechazar las demás
    await this.prisma.$transaction([
      this.prisma.proposal.update({ where: { id: proposalId }, data: { status: 'ACCEPTED' } }),
      this.prisma.proposal.updateMany({
        where: { requestId: proposal.requestId, id: { not: proposalId }, status: 'PENDING' },
        data: { status: 'REJECTED' },
      }),
      this.prisma.serviceRequest.update({
        where: { id: proposal.requestId },
        data: { status: 'ACCEPTED' },
      }),
    ]);

    // Generar automáticamente el contrato de servicio
    const contract = await this.contractsService.generateFromProposal(proposalId);

    // Notificar al ofertante aceptado
    await this.notifications.notify({
      profileId: proposal.providerId,
      type: 'PROPOSAL_ACCEPTED',
      title: '¡Te aceptaron la propuesta!',
      body: `Tu propuesta para "${proposal.request.title}" fue aceptada. Contrato ${contract.code} generado.`,
      entityType: 'contract',
      entityId: contract.id,
    });

    // Notificar a los ofertantes rechazados
    for (const other of otherPending) {
      await this.notifications.notify({
        profileId: other.providerId,
        type: 'PROPOSAL_REJECTED',
        title: 'Propuesta no seleccionada',
        body: `El solicitante eligió otra propuesta para "${proposal.request.title}".`,
        entityType: 'request',
        entityId: proposal.requestId,
      });
    }

    return {
      message: 'Propuesta aceptada. Contrato de servicio generado.',
      contractId: contract.id,
      contractCode: contract.code,
    };
  }

  /** Rechazar una propuesta (solo el solicitante) */
  async reject(userId: string, proposalId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { request: true },
    });
    if (!proposal) throw new NotFoundException('Propuesta no encontrada');
    if (proposal.request.requesterId !== profile.id) {
      throw new BadRequestException('Solo el solicitante puede rechazar propuestas');
    }

    const updated = await this.prisma.proposal.update({
      where: { id: proposalId },
      data: { status: 'REJECTED' },
    });

    await this.notifications.notify({
      profileId: proposal.providerId,
      type: 'PROPOSAL_REJECTED',
      title: 'Propuesta rechazada',
      body: `Tu propuesta para "${proposal.request.title}" fue rechazada.`,
      entityType: 'request',
      entityId: proposal.requestId,
    });

    return updated;
  }

  /** Retirar mi propuesta (solo el ofertante) */
  async withdraw(userId: string, proposalId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const proposal = await this.prisma.proposal.findFirst({
      where: { id: proposalId, providerId: profile.id, status: 'PENDING' },
    });
    if (!proposal) throw new NotFoundException('Propuesta no encontrada o no puede retirarse');

    return this.prisma.proposal.update({
      where: { id: proposalId },
      data: { status: 'WITHDRAWN' },
    });
  }

  /** Mis propuestas enviadas (como ofertante) */
  async findMyProposals(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) return [];

    return this.prisma.proposal.findMany({
      where: { providerId: profile.id },
      include: {
        request: { include: { category: true, requester: { select: { displayName: true, city: true } } } },
        contract: { select: { id: true, code: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
