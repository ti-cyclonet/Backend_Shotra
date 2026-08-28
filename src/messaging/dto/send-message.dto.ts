import { IsString, IsOptional, IsEnum } from 'class-validator';

export class SendMessageDto {
  @IsString()
  requestId: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsEnum(['TEXT', 'IMAGE', 'LOCATION'])
  type?: string;
}
