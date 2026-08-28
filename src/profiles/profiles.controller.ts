import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { CreateProfileDto, UpdateProfileDto, AddSkillDto } from './dto/create-profile.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  /** Obtiene (o crea) el perfil del usuario autenticado */
  @Get('me')
  getMyProfile(@CurrentUser() user: any) {
    return this.profilesService.findOrCreateProfile(user.userId, user.email);
  }

  /** Actualizar mi perfil */
  @Patch('me')
  updateMyProfile(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.profilesService.updateProfile(user.userId, dto);
  }

  /** Toggle "Listo para ganar" (disponibilidad) */
  @Patch('me/availability')
  toggleAvailability(@CurrentUser() user: any) {
    return this.profilesService.toggleAvailability(user.userId);
  }

  /** Agregar una habilidad a mi perfil */
  @Post('me/skills')
  addSkill(@CurrentUser() user: any, @Body() dto: AddSkillDto) {
    return this.profilesService.addSkill(user.userId, dto);
  }

  /** Eliminar una habilidad */
  @Delete('me/skills/:skillId')
  removeSkill(@CurrentUser() user: any, @Param('skillId') skillId: string) {
    return this.profilesService.removeSkill(user.userId, skillId);
  }

  /** Ver perfil público de un ofertante */
  @Public()
  @Get(':profileId')
  getPublicProfile(@Param('profileId') profileId: string) {
    return this.profilesService.getProfile(profileId);
  }

  /** Buscar ofertantes cercanos (público — para el marketplace) */
  @Public()
  @Get()
  findNearbyProviders(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('category') category?: string,
    @Query('radius') radius?: string,
  ) {
    if (!lat || !lng) {
      return { message: 'Parámetros lat y lng son requeridos para buscar ofertantes cercanos' };
    }
    return this.profilesService.findNearbyProviders(
      parseFloat(lat),
      parseFloat(lng),
      category,
      radius ? parseInt(radius) : 10,
    );
  }
}
