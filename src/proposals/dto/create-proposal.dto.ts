import { IsString, IsNumber, IsOptional, IsArray, ArrayMaxSize, Min } from 'class-validator';

export class CreateProposalDto {
  @IsString()
  requestId: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  estimatedTime?: string;

  /** Hasta 3 ids de fotos de mi portafolio para mostrar en esta oferta puntual. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  imageIds?: string[];

  /** Oferta hecha desde una ruta propia ("En ruta"); la solicitud debe caer en ella. */
  @IsOptional()
  @IsString()
  routeId?: string;
}
