import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ConfirmReceiptDto } from './dto/confirm-receipt.dto';

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  /** Generar contrato desde una propuesta aceptada */
  @Post('from-proposal/:proposalId')
  generateFromProposal(@Param('proposalId') proposalId: string) {
    return this.contractsService.generateFromProposal(proposalId);
  }

  /** Mis contratos */
  @Get('mine')
  findMine(@CurrentUser() user: any) {
    return this.contractsService.findMyContracts(user.userId);
  }

  /** Detalle de un contrato */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contractsService.findOne(id);
  }

  /** Firmar contrato */
  @Patch(':id/sign')
  sign(@CurrentUser() user: any, @Param('id') id: string) {
    return this.contractsService.sign(user.userId, id);
  }

  /** Paso 1 (ofertante): marcar el servicio como entregado */
  @Patch(':id/deliver')
  markDelivered(@CurrentUser() user: any, @Param('id') id: string) {
    return this.contractsService.markDelivered(user.userId, id);
  }

  /** Paso 2 (solicitante): confirmar recepción + declarar el pago */
  @Patch(':id/confirm')
  confirmReceipt(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ConfirmReceiptDto,
  ) {
    return this.contractsService.confirmReceipt(user.userId, id, dto);
  }
}
