import { Controller, Get, Patch, Param, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /** Listar mis notificaciones (opcional ?unread=true) */
  @Get()
  list(@CurrentUser() user: any, @Query('unread') unread?: string) {
    return this.notificationsService.list(user.userId, unread === 'true');
  }

  /** Marcar una como leída */
  @Patch(':id/read')
  markRead(@CurrentUser() user: any, @Param('id') id: string) {
    return this.notificationsService.markRead(user.userId, id);
  }

  /** Marcar todas como leídas */
  @Patch('read-all')
  markAllRead(@CurrentUser() user: any) {
    return this.notificationsService.markAllRead(user.userId);
  }
}
