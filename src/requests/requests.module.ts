import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { RequestExpiryService } from './request-expiry.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { RoutesModule } from '../routes/routes.module';

@Module({
  imports: [NotificationsModule, RoutesModule],
  controllers: [RequestsController],
  providers: [RequestsService, RequestExpiryService],
  exports: [RequestsService],
})
export class RequestsModule {}
