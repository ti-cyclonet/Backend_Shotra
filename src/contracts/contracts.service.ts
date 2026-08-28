import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Genera el contrato cuando se acepta una propuesta */
  async generateFromProposal(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { request: true, provider: true },
    });
    if (!proposal) throw new NotFoundException('Propuesta no encontrada');
    if (proposal.status !== 'ACCEPTED') throw new BadRequestException('La propuesta no ha sido aceptada');

    // Verificar que no exista ya un contrato para esta solicitud
    const existing = await this.prisma.serviceContract.findUnique({
      where: { requestId: proposal.requestId },
    });
    if (existing) return existing;

    // Generar código único SHO-XXXXX
    const count = await this.prisma.serviceContract.count();
    const code = `SHO-${String(count + 1).padStart(5, '0')}`;

    return this.prisma.serviceContract.create({
      data: {
        code,
        requestId: proposal.requestId,
        proposalId: proposal.id,
        requesterId: proposal.request.requesterId,
        providerId: proposal.providerId,
        agreedPrice: proposal.price,
        currency: proposal.currency,
        status: 'PENDING',
      },
      include: { request: { include: { category: true } }, proposal: true },
    });
  }

  /** Firmar contrato (ambas partes) */
  async sign(userId: string, contractId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const contract = await this.prisma.serviceContract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException('Contrato no encontrado');

    const now = new Date();
    const update: any = {};

    if (contract.requesterId === profile.id && !contract.requesterSignedAt) {
      update.requesterSignedAt = now;
    } else if (contract.providerId === profile.id && !contract.providerSignedAt) {
      update.providerSignedAt = now;
    } else {
      throw new BadRequestException('Ya firmaste este contrato o no eres parte de él');
    }

    const updated = await this.prisma.serviceContract.update({
      where: { id: contractId },
      data: update,
    });

    // Si ambos firmaron, activar el contrato
    if (updated.requesterSignedAt && updated.providerSignedAt) {
      return this.prisma.serviceContract.update({
        where: { id: contractId },
        data: { status: 'SIGNED', startedAt: now },
      });
    }

    return updated;
  }

  /** Marcar servicio como completado (cualquiera de las partes inicia; ambos deben confirmar) */
  async markCompleted(userId: string, contractId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const contract = await this.prisma.serviceContract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    if (contract.requesterId !== profile.id && contract.providerId !== profile.id) {
      throw new BadRequestException('No eres parte de este contrato');
    }
    if (!['SIGNED', 'IN_PROGRESS'].includes(contract.status)) {
      throw new BadRequestException('El contrato no está en un estado que permita marcar como completado');
    }

    return this.prisma.serviceContract.update({
      where: { id: contractId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  /** Mis contratos (como solicitante o proveedor) */
  async findMyContracts(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) return [];

    return this.prisma.serviceContract.findMany({
      where: { OR: [{ requesterId: profile.id }, { providerId: profile.id }] },
      include: {
        request: { include: { category: true } },
        proposal: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Detalle de un contrato */
  async findOne(contractId: string) {
    const contract = await this.prisma.serviceContract.findUnique({
      where: { id: contractId },
      include: {
        request: { include: { category: true, requester: { select: { displayName: true, avatarUrl: true } } } },
        proposal: { include: { provider: { select: { displayName: true, avatarUrl: true } } } },
        ratings: true,
        transaction: true,
      },
    });
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    return contract;
  }
}
