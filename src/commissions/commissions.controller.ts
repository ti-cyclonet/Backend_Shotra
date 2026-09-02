import { Controller, Get } from '@nestjs/common';
import { CommissionsService } from './commissions.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('commissions')
export class CommissionsController {
  constructor(private readonly commissionsService: CommissionsService) {}

  /** Estado de cuenta del ofertante autenticado */
  @Get('statement')
  statement(@CurrentUser() user: any) {
    return this.commissionsService.statement(user.userId);
  }
}
