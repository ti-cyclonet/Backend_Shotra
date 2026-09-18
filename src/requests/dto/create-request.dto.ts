import { IsString, IsOptional, IsNumber, IsBoolean, IsDateString } from 'class-validator';

export class CreateRequestDto {
  @IsString()
  categoryId: string;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsNumber()
  budgetMin?: number;

  @IsOptional()
  @IsNumber()
  budgetMax?: number;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  address?: string;

  // Origen del trayecto (recogida). Solo aplica a categorías con
  // requiresRoute (ej. domicilios); en otras categorías se ignora.
  @IsOptional()
  @IsNumber()
  originLatitude?: number;

  @IsOptional()
  @IsNumber()
  originLongitude?: number;

  @IsOptional()
  @IsString()
  originAddress?: string;

  @IsOptional()
  @IsBoolean()
  isRemote?: boolean;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsBoolean()
  isUrgent?: boolean;
}
