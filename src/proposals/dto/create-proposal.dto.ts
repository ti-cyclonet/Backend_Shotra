import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

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
}
