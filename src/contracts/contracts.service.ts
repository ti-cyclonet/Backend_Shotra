import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CommissionsService, PlanKey } from '../commissions/commissions.service';

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly commissions: CommissionsService,
  ) {}

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

    // Notificar a la otra parte que se registró una firma
    const otherPartyId = contract.requesterId === profile.id ? contract.providerId : contract.requesterId;
    await this.notifications.notify({
      profileId: otherPartyId,
      type: 'CONTRACT_SIGNED',
      title: 'Contrato firmado',
      body: `La otra parte firmó el contrato ${contract.code}.`,
      entityType: 'contract',
      entityId: contractId,
    });

    // Si ambos firmaron, activar el contrato
    if (updated.requesterSignedAt && updated.providerSignedAt) {
      const signed = await this.prisma.serviceContract.update({
        where: { id: contractId },
        data: { status: 'SIGNED', startedAt: now },
      });
      // Avisar a ambas partes que el contrato está activo
      for (const pid of [contract.requesterId, contract.providerId]) {
        await this.notifications.notify({
          profileId: pid,
          type: 'CONTRACT_SIGNED',
          title: 'Contrato activo',
          body: `El contrato ${contract.code} fue firmado por ambas partes. El servicio está en progreso.`,
          entityType: 'contract',
          entityId: contractId,
        });
      }
      return signed;
    }

    return updated;
  }

  /**
   * Paso 1 (ofertante): marcar el servicio como ENTREGADO.
   * Deja el contrato en PENDING_CONFIRMATION a la espera de que el solicitante
   * confirme recepción y declare el pago.
   */
  async markDelivered(userId: string, contractId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const contract = await this.prisma.serviceContract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    if (contract.providerId !== profile.id) {
      throw new BadRequestException('Solo el ofertante puede marcar el servicio como entregado');
    }
    if (!['SIGNED', 'IN_PROGRESS'].includes(contract.status)) {
      throw new BadRequestException('El contrato no está en un estado que permita marcar la entrega');
    }

    const updated = await this.prisma.serviceContract.update({
      where: { id: contractId },
      data: { status: 'PENDING_CONFIRMATION', providerCompletedAt: new Date() },
    });

    await this.notifications.notify({
      profileId: contract.requesterId,
      type: 'CONTRACT_COMPLETED',
      title: 'Confirma la recepción',
      body: `El ofertante marcó "${contract.code}" como entregado. Confirma que lo recibiste y registra el pago.`,
      entityType: 'contract',
      entityId: contractId,
    });

    return updated;
  }

  /**
   * Paso 2 (solicitante): confirmar RECEPCIÓN + declarar el pago del servicio.
   * Con ambas confirmaciones, el contrato pasa a COMPLETED y se devenga la comisión.
   */
  async confirmReceipt(userId: string, contractId: string, dto: any) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const contract = await this.prisma.serviceContract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    if (contract.requesterId !== profile.id) {
      throw new BadRequestException('Solo el solicitante puede confirmar la recepción');
    }
    // Se permite confirmar cuando el ofertante ya marcó entrega, o incluso
    // desde IN_PROGRESS/SIGNED (confirmación directa del solicitante).
    if (!['PENDING_CONFIRMATION', 'SIGNED', 'IN_PROGRESS'].includes(contract.status)) {
      throw new BadRequestException('El contrato no está en un estado que permita confirmar la recepción');
    }

    const now = new Date();

    // Registrar la declaración de pago (idempotente por contrato)
    const amount = typeof dto?.amount === 'number' && dto.amount > 0 ? dto.amount : contract.agreedPrice;
    await this.prisma.paymentDeclaration.upsert({
      where: { contractId },
      update: {
        method: dto.method,
        amount,
        voucherUrl: dto.voucherUrl ?? null,
        note: dto.note ?? null,
        declaredById: profile.id,
      },
      create: {
        contractId,
        method: dto.method,
        amount,
        currency: contract.currency,
        voucherUrl: dto.voucherUrl ?? null,
        note: dto.note ?? null,
        declaredById: profile.id,
      },
    });

    const completed = await this.prisma.serviceContract.update({
      where: { id: contractId },
      data: {
        status: 'COMPLETED',
        requesterConfirmedAt: now,
        // si el ofertante no había marcado entrega, se da por entregado al confirmar
        providerCompletedAt: contract.providerCompletedAt ?? now,
        completedAt: now,
      },
    });

    // Devengar la comisión SOLO ahora que ambas partes confirmaron.
    await this.accrueCommissionForContract(contract, completed.completedAt ?? now);

    await this.notifications.notify({
      profileId: contract.providerId,
      type: 'CONTRACT_COMPLETED',
      title: 'Servicio confirmado',
      body: `El solicitante confirmó la recepción y el pago de "${contract.code}". Ya pueden calificarse.`,
      entityType: 'contract',
      entityId: contractId,
    });

    return completed;
  }

  /** Devenga la comisión del ofertante (best-effort, no rompe el flujo). */
  private async accrueCommissionForContract(
    contract: { id: string; providerId: string; agreedPrice: number },
    completedAt: Date,
  ) {
    try {
      const provider = await this.prisma.userProfile.findUnique({
        where: { id: contract.providerId },
        select: { id: true, plan: true },
      });
      const planKey: PlanKey = provider?.plan === 'PRO' ? 'PRO' : 'FREE';
      await this.commissions.accrueForContract({
        contractId: contract.id,
        providerId: contract.providerId,
        grossAmount: contract.agreedPrice,
        planKey,
        completedAt,
      });
    } catch (err) {
      console.error('[ContractsService] accrue commission failed:', err);
    }
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
        paymentDeclaration: true,
      },
    });
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    return contract;
  }
}
