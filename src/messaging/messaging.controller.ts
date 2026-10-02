import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { SendMessageDto } from './dto/send-message.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('messaging')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  /** Enviar un mensaje */
  @Post()
  send(@CurrentUser() user: any, @Body() dto: SendMessageDto) {
    return this.messagingService.sendMessage(user.userId, dto);
  }

  /** Mis conversaciones activas */
  @Get('conversations')
  getConversations(@CurrentUser() user: any) {
    return this.messagingService.getConversations(user.userId);
  }

  /** Chat completo con la otra persona de esta solicitud: mensajes, si se puede escribir y a qué contrato. */
  @Get(':requestId/thread')
  getThread(@CurrentUser() user: any, @Param('requestId') requestId: string) {
    return this.messagingService.getThread(user.userId, requestId);
  }

  /** Mensajes del chat (todos los servicios con esa persona). Compatibilidad: InOut y apps anteriores. */
  @Get(':requestId')
  getMessages(@CurrentUser() user: any, @Param('requestId') requestId: string) {
    return this.messagingService.getMessages(user.userId, requestId);
  }

  /** Eliminar el chat para mí (la otra persona lo conserva). */
  @Delete(':requestId')
  hideThread(@CurrentUser() user: any, @Param('requestId') requestId: string) {
    return this.messagingService.hideThread(user.userId, requestId);
  }
}
