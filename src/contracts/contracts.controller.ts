import { Controller, Get, Post, Patch, Param } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

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

  /** Marcar servicio como completado */
  @Patch(':id/complete')
  markCompleted(@CurrentUser() user: any, @Param('id') id: string) {
    return this.contractsService.markCompleted(user.userId, id);
  }
}
