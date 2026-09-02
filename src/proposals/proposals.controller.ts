import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common';
import { ProposalsService } from './proposals.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  /** Enviar una propuesta */
  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateProposalDto) {
    return this.proposalsService.create(user.userId, dto);
  }

  /** Mis propuestas enviadas */
  @Get('mine')
  findMine(@CurrentUser() user: any) {
    return this.proposalsService.findMyProposals(user.userId);
  }

  /** Aceptar una propuesta (solicitante) */
  @Patch(':id/accept')
  accept(@CurrentUser() user: any, @Param('id') id: string) {
    return this.proposalsService.accept(user.userId, id);
  }

  /** Rechazar una propuesta (solicitante) */
  @Patch(':id/reject')
  reject(@CurrentUser() user: any, @Param('id') id: string) {
    return this.proposalsService.reject(user.userId, id);
  }

  /** Retirar mi propuesta (ofertante) */
  @Patch(':id/withdraw')
  withdraw(@CurrentUser() user: any, @Param('id') id: string) {
    return this.proposalsService.withdraw(user.userId, id);
  }
}
