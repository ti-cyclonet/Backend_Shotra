import { Controller, Post, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  /**
   * Sube un comprobante de pago (imagen o PDF) a Cloudinary.
   * Devuelve { url } con la URL segura para guardar en la declaración de pago.
   */
  @Post('voucher')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadVoucher(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    const url = await this.uploadsService.uploadFile(file, 'shotra/vouchers');
    return { url };
  }
}
