import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RoutesService } from './routes.service';
import { CoverageQueryDto, CreateRouteDto } from './dto/create-route.dto';

/** Pedidos en ruta: el ofertante publica un trayecto y recibe los domicilios que caen en él. */
@Controller('routes')
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateRouteDto) {
    return this.routes.create(user.userId, dto);
  }

  @Get('mine')
  mine(@CurrentUser() user: any) {
    return this.routes.mine(user.userId);
  }

  /** Cuántos ofertantes pasan por una recogida/entrega (solo el conteo). */
  @Get('coverage')
  coverage(@CurrentUser() user: any, @Query() q: CoverageQueryDto) {
    return this.routes.coverage(user.userId, q);
  }

  @Get(':id')
  detail(@CurrentUser() user: any, @Param('id') id: string) {
    return this.routes.detail(user.userId, id);
  }

  @Get(':id/matches')
  matches(@CurrentUser() user: any, @Param('id') id: string) {
    return this.routes.matches(user.userId, id);
  }

  @Patch(':id/matches/:matchId/dismiss')
  dismiss(@CurrentUser() user: any, @Param('id') id: string, @Param('matchId') matchId: string) {
    return this.routes.dismiss(user.userId, id, matchId);
  }

  @Patch(':id/complete')
  complete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.routes.close(user.userId, id, 'COMPLETED');
  }

  @Patch(':id/cancel')
  cancel(@CurrentUser() user: any, @Param('id') id: string) {
    return this.routes.close(user.userId, id, 'CANCELLED');
  }
}
