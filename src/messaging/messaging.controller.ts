import { Controller, Get, Post, Body, Param } from '@nestjs/common';
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

  /** Mensajes de una solicitud */
  @Get(':requestId')
  getMessages(@CurrentUser() user: any, @Param('requestId') requestId: string) {
    return this.messagingService.getMessages(user.userId, requestId);
  }
}
