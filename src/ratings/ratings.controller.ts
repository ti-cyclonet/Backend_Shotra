import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RatingsService } from './ratings.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  /** Evaluar un servicio completado */
  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateRatingDto) {
    return this.ratingsService.create(user.userId, dto);
  }

  /** Mis comentarios recibidos (anónimos y por grupos) y cuántos faltan por llegar. */
  @Get('me/feedback')
  myFeedback(@CurrentUser() user: any, @Query('role') role?: string) {
    return this.ratingsService.myFeedback(user.userId, role);
  }

  /** Comentarios de un perfil (público), anónimos y por grupos. ?role=PROVIDER|REQUESTER */
  @Public()
  @Get('profile/:profileId')
  findByProfile(@Param('profileId') profileId: string, @Query('role') role?: string) {
    return this.ratingsService.findByProfile(profileId, role);
  }
}
