import { IsString, IsNumber, IsOptional, IsBoolean, Min, Max, MaxLength } from 'class-validator';

/**
 * Los criterios aplicables dependen del rol del evaluado (ver reputation.ts):
 * al ofertante -> quality, punctuality, communication, priceFairness;
 * al solicitante -> clarity, payment, respect, access.
 * Los que no correspondan al rol se ignoran (versiones viejas de la app
 * enviaban quality/punctuality/communication en ambos sentidos).
 */
export class CreateRatingDto {
  @IsString()
  contractId: string;

  @IsNumber()
  @Min(1)
  @Max(5)
  score: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @IsOptional()
  @IsBoolean()
  wouldRepeat?: boolean;

  // Al ofertante
  @IsOptional() @IsNumber() @Min(1) @Max(5) quality?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(5) punctuality?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(5) communication?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(5) priceFairness?: number;

  // Al solicitante
  @IsOptional() @IsNumber() @Min(1) @Max(5) clarity?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(5) payment?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(5) respect?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(5) access?: number;
}
