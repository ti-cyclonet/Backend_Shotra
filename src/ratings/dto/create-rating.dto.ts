import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class CreateRatingDto {
  @IsString()
  contractId: string;

  @IsNumber()
  @Min(1)
  @Max(5)
  score: number;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  quality?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  punctuality?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  communication?: number;
}
