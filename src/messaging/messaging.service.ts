import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * El chat solo se habilita una vez la propuesta fue aceptada y AMBAS partes
   * firmaron el contrato de servicio (requesterSignedAt y providerSignedAt).
   * Antes de eso (propuesta pendiente, o contrato generado pero sin firmar)
   * no hay conversación: evita que un ofertante le escriba al solicitante
   * antes de que este acepte su propuesta.
   * Una vez el trabajo se finaliza (COMPLETED/EVALUATED) el chat se cierra
   * de nuevo, igual que en la UI (botón "Chat" deshabilitado).
   */
  private async assertSignedContractAccess(requestId: string, profileId: string) {
    const contract = await this.prisma.serviceContract.findUnique({ where: { requestId } });
    if (!contract || !contract.requesterSignedAt || !contract.providerSignedAt) {
      throw new BadRequestException(
        'El chat se activa cuando la propuesta es aceptada y ambas partes firman el contrato.',
      );
    }
    const isParty = contract.requesterId === profileId || contract.providerId === profileId;
    if (!isParty) {
      throw new BadRequestException('No tienes acceso a esta conversación');
    }
    if (contract.status === 'COMPLETED' || contract.status === 'EVALUATED') {
      throw new BadRequestException('Este chat ya no está disponible: el trabajo fue finalizado.');
    }
    return contract;
  }

  /** Enviar un mensaje en el contexto de una solicitud */
  async sendMessage(userId: string, dto: SendMessageDto) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const request = await this.prisma.serviceRequest.findUnique({ where: { id: dto.requestId } });
    if (!request) throw new NotFoundException('Solicitud no encontrada');

    const contract = await this.assertSignedContractAccess(dto.requestId, profile.id);

    const message = await this.prisma.message.create({
      data: {
        requestId: dto.requestId,
        senderId: profile.id,
        content: dto.content,
        type: (dto.type as any) || 'TEXT',
      },
      include: { sender: { select: { displayName: true, avatarUrl: true } } },
    });

    // Notificar a la OTRA parte (banner + sonido, vía NotificationsContext del
    // cliente): quien no envió el mensaje. entityType 'chat' lleva directo a
    // la conversación en vez del detalle de la solicitud.
    const otherPartyId = contract.requesterId === profile.id ? contract.providerId : contract.requesterId;
    await this.notifications.notify({
      profileId: otherPartyId,
      type: 'NEW_MESSAGE',
      title: message.sender?.displayName || 'Nuevo mensaje',
      body: dto.content.length > 120 ? `${dto.content.slice(0, 117)}...` : dto.content,
      entityType: 'chat',
      entityId: dto.requestId,
    });

    return message;
  }

  /** Obtener mensajes de una solicitud */
  async getMessages(userId: string, requestId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const request = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Solicitud no encontrada');

    await this.assertSignedContractAccess(requestId, profile.id);

    // Marcar mensajes como leídos (los que no son míos)
    await this.prisma.message.updateMany({
      where: { requestId, senderId: { not: profile.id }, readAt: null },
      data: { readAt: new Date() },
    });

    return this.prisma.message.findMany({
      where: { requestId },
      include: { sender: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Conversaciones activas del usuario */
  async getConversations(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) return [];

    // Solo solicitudes con contrato firmado por ambas partes (ahí es donde el
    // chat está habilitado), donde soy el solicitante o el ofertante.
    const signedContracts = await this.prisma.serviceContract.findMany({
      where: {
        OR: [{ requesterId: profile.id }, { providerId: profile.id }],
        requesterSignedAt: { not: null },
        providerSignedAt: { not: null },
      },
      select: { requestId: true, status: true },
    });

    const statusByRequestId = new Map(signedContracts.map((c) => [c.requestId, c.status]));
    const allRequestIds = new Set(signedContracts.map((c) => c.requestId));

    // Para cada conversación, obtener último mensaje y count no leídos
    const conversations: { requestId: string; lastMessage: any; unreadCount: number; closed: boolean }[] = [];
    for (const requestId of allRequestIds) {
      const lastMessage = await this.prisma.message.findFirst({
        where: { requestId },
        orderBy: { createdAt: 'desc' },
        include: { sender: { select: { displayName: true } } },
      });
      const unread = await this.prisma.message.count({
        where: { requestId, senderId: { not: profile.id }, readAt: null },
      });
      const status = statusByRequestId.get(requestId);
      const closed = status === 'COMPLETED' || status === 'EVALUATED';
      if (lastMessage) {
        conversations.push({ requestId, lastMessage, unreadCount: unread, closed });
      }
    }

    return conversations.sort((a, b) =>
      new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime(),
    );
  }
}
