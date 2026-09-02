import { Module } from '@nestjs/common';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';
import { CommissionBillingService } from './commission-billing.service';
import { AuthorizaClient } from './authoriza.client';

@Module({
  controllers: [CommissionsController],
  providers: [CommissionsService, CommissionBillingService, AuthorizaClient],
  exports: [CommissionsService],
})
export class CommissionsModule {}
