import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  /** Crear una solicitud de servicio */
  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateRequestDto) {
    return this.requestsService.create(user.userId, dto);
  }

  /** Mis solicitudes (como solicitante) */
  @Get('mine')
  findMine(@CurrentUser() user: any) {
    return this.requestsService.findMyRequests(user.userId);
  }

  /** Feed de solicitudes publicadas (para ofertantes) */
  @Public()
  @Get()
  findPublished(
    @Query('category') category?: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('radius') radius?: string,
  ) {
    return this.requestsService.findPublished({
      categorySlug: category,
      lat: lat ? parseFloat(lat) : undefined,
      lng: lng ? parseFloat(lng) : undefined,
      radiusKm: radius ? parseInt(radius) : undefined,
    });
  }

  /** Detalle de una solicitud */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.requestsService.findOne(id);
  }

  /** Cancelar solicitud */
  @Patch(':id/cancel')
  cancel(@CurrentUser() user: any, @Param('id') id: string) {
    return this.requestsService.cancel(user.userId, id);
  }
}
