import { IsString, IsOptional, MinLength } from 'class-validator';

export class CreatePortfolioItemDto {
  @IsString()
  @MinLength(2)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
}
