import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class MessagingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Enviar un mensaje en el contexto de una solicitud */
  async sendMessage(userId: string, dto: SendMessageDto) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    // Verificar que la solicitud existe
    const request = await this.prisma.serviceRequest.findUnique({ where: { id: dto.requestId } });
    if (!request) throw new NotFoundException('Solicitud no encontrada');

    // Verificar que el usuario es parte de la conversación (solicitante o un ofertante con propuesta)
    const isRequester = request.requesterId === profile.id;
    const hasProposal = await this.prisma.proposal.findFirst({
      where: { requestId: dto.requestId, providerId: profile.id },
    });
    if (!isRequester && !hasProposal) {
      throw new BadRequestException('No tienes acceso a esta conversación');
    }

    return this.prisma.message.create({
      data: {
        requestId: dto.requestId,
        senderId: profile.id,
        content: dto.content,
        type: (dto.type as any) || 'TEXT',
      },
      include: { sender: { select: { displayName: true, avatarUrl: true } } },
    });
  }

  /** Obtener mensajes de una solicitud */
  async getMessages(userId: string, requestId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    // Verificar acceso
    const request = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Solicitud no encontrada');

    const isRequester = request.requesterId === profile.id;
    const hasProposal = await this.prisma.proposal.findFirst({
      where: { requestId, providerId: profile.id },
    });
    if (!isRequester && !hasProposal) {
      throw new BadRequestException('No tienes acceso a esta conversación');
    }

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

    // Solicitudes donde soy requester o tengo propuesta
    const myRequests = await this.prisma.serviceRequest.findMany({
      where: { requesterId: profile.id, messages: { some: {} } },
      select: { id: true, title: true, status: true },
    });

    const myProposalRequests = await this.prisma.proposal.findMany({
      where: { providerId: profile.id },
      select: { request: { select: { id: true, title: true, status: true } } },
    });

    const allRequestIds = new Set([
      ...myRequests.map((r) => r.id),
      ...myProposalRequests.map((p) => p.request.id),
    ]);

    // Para cada conversación, obtener último mensaje y count no leídos
    const conversations: { requestId: string; lastMessage: any; unreadCount: number }[] = [];
    for (const requestId of allRequestIds) {
      const lastMessage = await this.prisma.message.findFirst({
        where: { requestId },
        orderBy: { createdAt: 'desc' },
        include: { sender: { select: { displayName: true } } },
      });
      const unread = await this.prisma.message.count({
        where: { requestId, senderId: { not: profile.id }, readAt: null },
      });
      if (lastMessage) {
        conversations.push({ requestId, lastMessage, unreadCount: unread });
      }
    }

    return conversations.sort((a, b) =>
      new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime(),
    );
  }
}
