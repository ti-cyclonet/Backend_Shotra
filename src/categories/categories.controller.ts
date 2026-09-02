import { Controller, Get, Param } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /** Lista categorías con subcategorías (público) */
  @Public()
  @Get()
  findAll() {
    return this.categoriesService.findAll();
  }

  /** Subcategorías planas (para selects/filtros) */
  @Public()
  @Get('leaves')
  findLeaves() {
    return this.categoriesService.findLeaves();
  }

  /** Categoría por slug */
  @Public()
  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.categoriesService.findBySlug(slug);
  }
}
