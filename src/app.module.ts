import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { ProfilesModule } from './profiles/profiles.module';
import { CategoriesModule } from './categories/categories.module';
import { RequestsModule } from './requests/requests.module';
import { ProposalsModule } from './proposals/proposals.module';
import { ContractsModule } from './contracts/contracts.module';
import { RatingsModule } from './ratings/ratings.module';
import { MessagingModule } from './messaging/messaging.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    HealthModule,
    ProfilesModule,
    CategoriesModule,
    RequestsModule,
    ProposalsModule,
    ContractsModule,
    RatingsModule,
    MessagingModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
