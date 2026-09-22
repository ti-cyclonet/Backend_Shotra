import { Controller, Get, Post, Delete, Body, Param, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PortfolioService } from './portfolio.service';
import { CreatePortfolioItemDto } from './dto/create-portfolio-item.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  /** Agregar una foto de un trabajo realizado a mi portafolio */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  create(
    @CurrentUser() user: any,
    @Body() dto: CreatePortfolioItemDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.portfolioService.create(user.userId, dto, file);
  }

  /** Eliminar una foto de mi portafolio */
  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.portfolioService.remove(user.userId, id);
  }

  /** Ver el portafolio público de un ofertante */
  @Public()
  @Get('profile/:profileId')
  findByProfile(@Param('profileId') profileId: string) {
    return this.portfolioService.findByProfile(profileId);
  }
}
