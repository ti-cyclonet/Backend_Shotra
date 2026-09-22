import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreatePortfolioItemDto } from './dto/create-portfolio-item.dto';

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  /** Agrega una foto de un trabajo realizado al portafolio público del ofertante. */
  async create(userId: string, dto: CreatePortfolioItemDto, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Debes adjuntar una imagen del trabajo realizado');

    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const imageUrl = await this.uploads.uploadFile(file, 'shotra/portfolio');

    return this.prisma.portfolioItem.create({
      data: {
        profileId: profile.id,
        title: dto.title,
        description: dto.description,
        imageUrl,
      },
    });
  }

  /** Elimina una foto del propio portafolio. */
  async remove(userId: string, itemId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const item = await this.prisma.portfolioItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Elemento no encontrado');
    if (item.profileId !== profile.id) throw new ForbiddenException('No puedes eliminar este elemento');

    await this.prisma.portfolioItem.delete({ where: { id: itemId } });
    return { message: 'Eliminado' };
  }

  /** Portafolio público de un ofertante (mismo dato que ya viaja dentro de
   * GET /profiles/:id, expuesto también suelto para consumo puntual). */
  async findByProfile(profileId: string) {
    return this.prisma.portfolioItem.findMany({
      where: { profileId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
