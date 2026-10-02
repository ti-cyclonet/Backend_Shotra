import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SendMessageDto } from './dto/send-message.dto';

/** Contrato en el que se puede chatear: firmado por ambos y sin finalizar. */
const ACTIVE_CHAT_STATUSES = ['SIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'DISPUTED'];

type PairContract = {
  requestId: string;
  status: string;
  requesterId: string;
  providerId: string;
  requesterSignedAt: Date | null;
  providerSignedAt: Date | null;
  createdAt: Date;
};

const isSigned = (c: { requesterSignedAt: Date | null; providerSignedAt: Date | null }) => !!c.requesterSignedAt && !!c.providerSignedAt;
const isActive = (c: PairContract) => isSigned(c) && ACTIVE_CHAT_STATUSES.includes(c.status);

/**
 * Chat de Shotra: UNO por par de personas (no uno por solicitud).
 *
 * - El historial reúne los mensajes de todos los servicios entre las dos
 *   personas (cada mensaje sigue ligado a su solicitud, para los separadores).
 * - Solo se escribe mientras haya un contrato firmado por ambos y sin
 *   finalizar; al finalizar queda de solo lectura y, si vuelven a contratar,
 *   el mismo chat se habilita y los mensajes nuevos van al contrato activo.
 * - Cada usuario puede eliminar el chat para sí mismo (ChatHide): se le ocultan
 *   los mensajes anteriores y reaparece si hay mensajes o contrato nuevos.
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async myProfile(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');
    return profile;
  }

  /**
   * Resuelve el chat a partir de una de sus solicitudes: la otra persona y
   * todos los contratos firmados entre los dos. Exige que yo sea parte.
   */
  private async pairFromRequest(requestId: string, profileId: string) {
    const contract = await this.prisma.serviceContract.findUnique({ where: { requestId } });
    if (!contract || !isSigned(contract)) {
      throw new BadRequestException('El chat se activa cuando la propuesta es aceptada y ambas partes firman el contrato.');
    }
    if (contract.requesterId !== profileId && contract.providerId !== profileId) {
      throw new BadRequestException('No tienes acceso a esta conversación');
    }
    const otherId = contract.requesterId === profileId ? contract.providerId : contract.requesterId;
    const contracts = await this.pairContracts(profileId, otherId);
    return { otherId, contracts };
  }

  /** Contratos firmados por ambos entre dos personas (en cualquier rol). */
  private pairContracts(a: string, b: string): Promise<PairContract[]> {
    return this.prisma.serviceContract.findMany({
      where: {
        OR: [{ requesterId: a, providerId: b }, { requesterId: b, providerId: a }],
        requesterSignedAt: { not: null },
        providerSignedAt: { not: null },
      },
      select: { requestId: true, status: true, requesterId: true, providerId: true, requesterSignedAt: true, providerSignedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async hiddenBefore(profileId: string, otherId: string): Promise<Date | null> {
    const hide = await this.prisma.chatHide.findUnique({
      where: { profileId_otherProfileId: { profileId, otherProfileId: otherId } },
    });
    return hide?.hiddenBefore || null;
  }

  /**
   * Enviar un mensaje. Va al contrato ACTIVO entre las dos personas: si la
   * solicitud indicada ya terminó pero tienen otro contrato en curso, el
   * mensaje se guarda en ese (así sigue funcionando el mismo chat).
   */
  async sendMessage(userId: string, dto: SendMessageDto) {
    const profile = await this.myProfile(userId);
    const { otherId, contracts } = await this.pairFromRequest(dto.requestId, profile.id);
    const active = contracts.find((c) => c.requestId === dto.requestId && isActive(c)) || contracts.find(isActive);
    if (!active) {
      throw new BadRequestException('Este chat es de solo lectura: el trabajo fue finalizado. Se habilita de nuevo si vuelven a tener un servicio en curso.');
    }

    const message = await this.prisma.message.create({
      data: {
        requestId: active.requestId,
        senderId: profile.id,
        content: dto.content,
        type: (dto.type as any) || 'TEXT',
      },
      include: { sender: { select: { displayName: true, avatarUrl: true } } },
    });

    // Notificar a la otra parte; entityType 'chat' lleva directo a la conversación
    await this.notifications.notify({
      profileId: otherId,
      type: 'NEW_MESSAGE',
      title: message.sender?.displayName || 'Nuevo mensaje',
      body: dto.content.length > 120 ? `${dto.content.slice(0, 117)}...` : dto.content,
      entityType: 'chat',
      entityId: active.requestId,
    });

    return message;
  }

  /**
   * Chat completo con la otra persona de esta solicitud (todos sus servicios),
   * sin lo que yo eliminé. Marca como leídos los mensajes recibidos.
   */
  async getThread(userId: string, requestId: string) {
    const profile = await this.myProfile(userId);
    const { otherId, contracts } = await this.pairFromRequest(requestId, profile.id);
    const hiddenBefore = await this.hiddenBefore(profile.id, otherId);
    const requestIds = contracts.map((c) => c.requestId);
    const visible = { requestId: { in: requestIds }, ...(hiddenBefore ? { createdAt: { gt: hiddenBefore } } : {}) };

    await this.prisma.message.updateMany({
      where: { ...visible, senderId: { not: profile.id }, readAt: null },
      data: { readAt: new Date() },
    });

    const [messages, otherParty, requests] = await Promise.all([
      this.prisma.message.findMany({
        where: visible,
        include: { sender: { select: { id: true, displayName: true, avatarUrl: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.userProfile.findUnique({ where: { id: otherId }, select: { id: true, displayName: true, avatarUrl: true } }),
      this.prisma.serviceRequest.findMany({ where: { id: { in: requestIds } }, select: { id: true, title: true } }),
    ]);

    const active = contracts.find(isActive) || null;
    return {
      otherParty,
      canSend: !!active,
      activeRequestId: active?.requestId || null,
      requests: requests.map((r) => ({
        id: r.id,
        title: r.title,
        status: contracts.find((c) => c.requestId === r.id)?.status || null,
      })),
      messages,
    };
  }

  /** Compatibilidad (InOut y versiones anteriores de la app): solo los mensajes del chat. */
  async getMessages(userId: string, requestId: string) {
    return (await this.getThread(userId, requestId)).messages;
  }

  /** Eliminar el chat para mí: oculta el historial actual (la otra persona lo conserva). */
  async hideThread(userId: string, requestId: string) {
    const profile = await this.myProfile(userId);
    const { otherId } = await this.pairFromRequest(requestId, profile.id);
    const now = new Date();
    await this.prisma.chatHide.upsert({
      where: { profileId_otherProfileId: { profileId: profile.id, otherProfileId: otherId } },
      update: { hiddenBefore: now },
      create: { profileId: profile.id, otherProfileId: otherId, hiddenBefore: now },
    });
    // Lo eliminado no debe quedar contando como no leído
    const requestIds = (await this.pairContracts(profile.id, otherId)).map((c) => c.requestId);
    await this.prisma.message.updateMany({
      where: { requestId: { in: requestIds }, senderId: otherId, readAt: null, createdAt: { lte: now } },
      data: { readAt: now },
    });
    return { deleted: true };
  }

  /**
   * Mis chats: uno por persona. `requestId` abre el chat (el contrato activo
   * si lo hay; si no, el más reciente). `closed` = solo lectura.
   */
  async getConversations(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) return [];

    const contracts = await this.prisma.serviceContract.findMany({
      where: {
        OR: [{ requesterId: profile.id }, { providerId: profile.id }],
        requesterSignedAt: { not: null },
        providerSignedAt: { not: null },
      },
      select: { requestId: true, status: true, requesterId: true, providerId: true, requesterSignedAt: true, providerSignedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const byOther = new Map<string, PairContract[]>();
    for (const c of contracts) {
      const otherId = c.requesterId === profile.id ? c.providerId : c.requesterId;
      byOther.set(otherId, [...(byOther.get(otherId) || []), c]);
    }
    if (byOther.size === 0) return [];

    const [others, hides] = await Promise.all([
      this.prisma.userProfile.findMany({ where: { id: { in: [...byOther.keys()] } }, select: { id: true, displayName: true, avatarUrl: true } }),
      this.prisma.chatHide.findMany({ where: { profileId: profile.id, otherProfileId: { in: [...byOther.keys()] } } }),
    ]);
    const otherById = new Map(others.map((o) => [o.id, o]));
    const hiddenBy = new Map(hides.map((h) => [h.otherProfileId, h.hiddenBefore]));

    const conversations: any[] = [];
    for (const [otherId, list] of byOther) {
      const requestIds = list.map((c) => c.requestId);
      const hiddenBefore = hiddenBy.get(otherId);
      const visible = { requestId: { in: requestIds }, ...(hiddenBefore ? { createdAt: { gt: hiddenBefore } } : {}) };
      const [lastMessage, unreadCount] = await Promise.all([
        this.prisma.message.findFirst({ where: visible, orderBy: { createdAt: 'desc' }, include: { sender: { select: { displayName: true } } } }),
        this.prisma.message.count({ where: { ...visible, senderId: otherId, readAt: null } }),
      ]);
      const active = list.find(isActive);
      // Se muestra si tiene mensajes visibles o un servicio en curso
      if (!lastMessage && !active) continue;
      conversations.push({
        requestId: (active || list[0]).requestId,
        otherPartyId: otherId,
        otherParty: otherById.get(otherId) || null,
        lastMessage,
        unreadCount,
        closed: !active,
        servicesCount: list.length,
        sortAt: lastMessage?.createdAt || (active || list[0]).createdAt,
      });
    }

    return conversations
      .sort((a, b) => new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime())
      .map(({ sortAt, ...c }) => c);
  }
}
