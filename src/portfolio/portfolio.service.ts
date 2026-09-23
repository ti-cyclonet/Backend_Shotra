import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreatePortfolioItemDto } from './dto/create-portfolio-item.dto';
import { UpdatePortfolioOfferDto } from './dto/update-portfolio-offer.dto';

const MAX_PORTFOLIO_ITEMS = 10;
const MAX_ITEMS_IN_OFFER = 3;

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  /** Agrega una foto de un trabajo realizado al portafolio del ofertante
   * (máximo 10 en total; elimina alguna para poder subir una nueva). */
  async create(userId: string, dto: CreatePortfolioItemDto, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Debes adjuntar una imagen del trabajo realizado');

    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const currentCount = await this.prisma.portfolioItem.count({ where: { profileId: profile.id } });
    if (currentCount >= MAX_PORTFOLIO_ITEMS) {
      throw new BadRequestException(
        `Ya alcanzaste el máximo de ${MAX_PORTFOLIO_ITEMS} imágenes. Elimina alguna para subir una nueva.`,
      );
    }

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

  /** Elige (o quita) una foto para mostrarse en las ofertas del ofertante
   * (máximo 3 activas a la vez). */
  async setShowInOffer(userId: string, itemId: string, dto: UpdatePortfolioOfferDto) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const item = await this.prisma.portfolioItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Elemento no encontrado');
    if (item.profileId !== profile.id) throw new ForbiddenException('No puedes modificar este elemento');

    if (dto.showInOffer && !item.showInOffer) {
      const selectedCount = await this.prisma.portfolioItem.count({
        where: { profileId: profile.id, showInOffer: true },
      });
      if (selectedCount >= MAX_ITEMS_IN_OFFER) {
        throw new BadRequestException(
          `Ya tienes ${MAX_ITEMS_IN_OFFER} imágenes seleccionadas para tu oferta. Deselecciona una primero.`,
        );
      }
    }

    return this.prisma.portfolioItem.update({
      where: { id: itemId },
      data: { showInOffer: dto.showInOffer },
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
