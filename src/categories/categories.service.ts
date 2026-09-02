import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista todas las categorías raíz con sus hijos */
  async findAll() {
    return this.prisma.serviceCategory.findMany({
      where: { parentId: null, isActive: true },
      include: {
        children: {
          where: { isActive: true },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { order: 'asc' },
    });
  }

  /** Obtiene una categoría por slug con sus hijos */
  async findBySlug(slug: string) {
    const category = await this.prisma.serviceCategory.findUnique({
      where: { slug },
      include: { children: { where: { isActive: true } } },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    return category;
  }

  /** Obtiene todas las subcategorías (hojas) — útil para selects */
  async findLeaves() {
    return this.prisma.serviceCategory.findMany({
      where: { isActive: true, children: { none: {} } },
      include: { parent: { select: { name: true, slug: true } } },
      orderBy: { name: 'asc' },
    });
  }
}
