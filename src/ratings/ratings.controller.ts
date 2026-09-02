import { Controller, Get, Post, Body, Param } from '@nestjs/common';
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

  /** Ver evaluaciones de un perfil (público) */
  @Public()
  @Get('profile/:profileId')
  findByProfile(@Param('profileId') profileId: string) {
    return this.ratingsService.findByProfile(profileId);
  }
}
