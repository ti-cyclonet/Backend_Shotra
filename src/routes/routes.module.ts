import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { RouteMatcherService } from './route-matcher.service';
import { RouteExpiryService } from './route-expiry.service';
import { OsrmClient } from './osrm.client';

@Module({
  imports: [NotificationsModule],
  controllers: [RoutesController],
  providers: [RoutesService, RouteMatcherService, RouteExpiryService, OsrmClient],
  exports: [RouteMatcherService],
})
export class RoutesModule {}
