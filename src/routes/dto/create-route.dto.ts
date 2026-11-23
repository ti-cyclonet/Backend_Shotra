import { IsDateString, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateRouteDto {
  @IsLatitude()
  originLatitude: number;

  @IsLongitude()
  originLongitude: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  originAddress?: string;

  @IsLatitude()
  destLatitude: number;

  @IsLongitude()
  destLongitude: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  destAddress?: string;

  /** Hora de salida. Sin valor = ahora. */
  @IsOptional()
  @IsDateString()
  departAt?: string;

  /** Cuánto se aparta de su camino (ver DETOUR_PRESETS). Default MEDIUM. */
  @IsOptional()
  @IsIn(['SHORT', 'MEDIUM', 'WIDE'])
  detour?: 'SHORT' | 'MEDIUM' | 'WIDE';

  @IsOptional()
  @IsIn(['SMALL', 'MEDIUM', 'LARGE'])
  maxPackageSize?: 'SMALL' | 'MEDIUM' | 'LARGE';

  /** Pedidos que acepta llevar a la vez en esta ruta. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  maxOrders?: number;
}

export class CoverageQueryDto {
  @IsLatitude()
  pickLat: number;

  @IsLongitude()
  pickLng: number;

  @IsLatitude()
  dropLat: number;

  @IsLongitude()
  dropLng: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Fecha de servicio, si la solicitud es programada. */
  @IsOptional()
  @IsDateString()
  at?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  urgent?: string;

  @IsOptional()
  @IsIn(['SMALL', 'MEDIUM', 'LARGE'])
  packageSize?: 'SMALL' | 'MEDIUM' | 'LARGE';
}
