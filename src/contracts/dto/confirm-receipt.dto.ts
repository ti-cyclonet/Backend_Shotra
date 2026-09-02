import { IsEnum, IsNumber, IsOptional, IsString, IsPositive } from 'class-validator';

export enum PaymentMethodDto {
  CASH = 'CASH',
  TRANSFER = 'TRANSFER',
  NEQUI = 'NEQUI',
  DAVIPLATA = 'DAVIPLATA',
  PSE = 'PSE',
  OTHER = 'OTHER',
}

export class ConfirmReceiptDto {
  @IsEnum(PaymentMethodDto, {
    message: 'method debe ser uno de: CASH, TRANSFER, NEQUI, DAVIPLATA, PSE, OTHER',
  })
  method: PaymentMethodDto;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number; // por defecto = agreedPrice

  @IsOptional()
  @IsString()
  voucherUrl?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
