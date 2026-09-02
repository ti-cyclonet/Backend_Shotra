import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ShotraAccessGuard } from './guards/shotra-access.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.AUTHORIZA_JWT_SECRET || process.env.JWT_SECRET || 'default',
    }),
  ],
  providers: [JwtStrategy, JwtAuthGuard, ShotraAccessGuard],
  exports: [JwtAuthGuard, ShotraAccessGuard, JwtModule],
})
export class AuthModule {}
