import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  /**
   * Sube un archivo (imagen o documento) a Cloudinary y devuelve la URL segura.
   * Usa resource_type 'auto' para aceptar imágenes y PDFs.
   */
  async uploadFile(file: Express.Multer.File, folder = 'shotra/vouchers'): Promise<string> {
    if (!file || !file.buffer) throw new BadRequestException('Archivo inválido');

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'auto' },
        (error, res) => {
          if (error || !res) {
            this.logger.error(`Cloudinary upload error: ${error?.message}`);
            return reject(error || new Error('Upload failed'));
          }
          resolve(res);
        },
      );
      const readable = new Readable();
      readable.push(file.buffer);
      readable.push(null);
      readable.pipe(uploadStream);
    });

    return result.secure_url;
  }
}
