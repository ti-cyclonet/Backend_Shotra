import { IsString, IsOptional, IsBoolean, IsNumber, Min, Max } from 'class-validator';

export class CreateProfileDto {
  @IsString()
  displayName: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  serviceRadius?: number;

  @IsOptional()
  @IsBoolean()
  isProvider?: boolean;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  serviceRadius?: number;

  @IsOptional()
  @IsBoolean()
  isProvider?: boolean;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

export class AddSkillDto {
  @IsString()
  categoryId: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  yearsExp?: number;
}
