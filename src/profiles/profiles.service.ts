import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProfileDto, UpdateProfileDto, AddSkillDto } from './dto/create-profile.dto';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateProfile(userId: string, email: string, rol?: string) {
    // Derivar el plan del rol de Authoriza: adminShotra=PRO, userShotra=FREE
    const planFromRole = rol === 'adminShotra' ? 'PRO' : 'FREE';

    let profile = await this.prisma.userProfile.findUnique({
      where: { authorizaUserId: userId },
      include: { skills: { include: { category: true } }, portfolio: true },
    });

    if (!profile) {
      profile = await this.prisma.userProfile.create({
        data: {
          authorizaUserId: userId,
          email,
          displayName: email.split('@')[0],
          plan: planFromRole,
        },
        include: { skills: { include: { category: true } }, portfolio: true },
      });
    } else if (rol && profile.plan !== planFromRole) {
      // Mantener el plan sincronizado con el rol vigente en Authoriza
      profile = await this.prisma.userProfile.update({
        where: { id: profile.id },
        data: { plan: planFromRole },
        include: { skills: { include: { category: true } }, portfolio: true },
      });
    }

    return profile;
  }

  async getProfile(profileId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { id: profileId },
      include: {
        skills: { include: { category: true } },
        portfolio: true,
        ratingsReceived: { take: 10, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!profile) throw new NotFoundException('Perfil no encontrado');
    return profile;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { authorizaUserId: userId },
    });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    return this.prisma.userProfile.update({
      where: { id: profile.id },
      data: dto,
      include: { skills: { include: { category: true } } },
    });
  }

  async toggleAvailability(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { authorizaUserId: userId },
    });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    return this.prisma.userProfile.update({
      where: { id: profile.id },
      data: { isAvailable: !profile.isAvailable },
    });
  }

  async addSkill(userId: string, dto: AddSkillDto) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { authorizaUserId: userId },
    });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    // Verificar que la categoría existe
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    // Verificar que no tenga ya esta habilidad
    const existing = await this.prisma.providerSkill.findUnique({
      where: { profileId_categoryId: { profileId: profile.id, categoryId: dto.categoryId } },
    });
    if (existing) throw new ConflictException('Ya tienes esta habilidad registrada');

    return this.prisma.providerSkill.create({
      data: {
        profileId: profile.id,
        categoryId: dto.categoryId,
        description: dto.description,
        yearsExp: dto.yearsExp,
      },
      include: { category: true },
    });
  }

  async removeSkill(userId: string, skillId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { authorizaUserId: userId },
    });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const skill = await this.prisma.providerSkill.findFirst({
      where: { id: skillId, profileId: profile.id },
    });
    if (!skill) throw new NotFoundException('Habilidad no encontrada');

    await this.prisma.providerSkill.delete({ where: { id: skillId } });
    return { message: 'Habilidad eliminada' };
  }

  /**
   * Busca ofertantes cercanos a una ubicación con una categoría específica.
   * Usa cálculo de distancia por coordenadas (fórmula de Haversine simplificada).
   */
  async findNearbyProviders(lat: number, lng: number, categorySlug?: string, radiusKm = 10) {
    // Construir query base: ofertantes activos con ubicación
    const providers = await this.prisma.userProfile.findMany({
      where: {
        isProvider: true,
        isAvailable: true,
        latitude: { not: null },
        longitude: { not: null },
        ...(categorySlug && {
          skills: { some: { category: { slug: categorySlug } } },
        }),
      },
      include: {
        skills: { include: { category: true } },
      },
    });

    // Filtrar por distancia (Haversine aproximado)
    const R = 6371; // Radio de la Tierra en km
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const nearby = providers
      .map((p) => {
        const dLat = toRad(p.latitude! - lat);
        const dLng = toRad(p.longitude! - lng);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(lat)) * Math.cos(toRad(p.latitude!)) * Math.sin(dLng / 2) ** 2;
        const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return { ...p, distance: Math.round(distance * 10) / 10 };
      })
      .filter((p) => p.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance);

    return nearby;
  }
}
