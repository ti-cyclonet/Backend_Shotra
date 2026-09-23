import { IsBoolean } from 'class-validator';

export class UpdatePortfolioOfferDto {
  @IsBoolean()
  showInOffer: boolean;
}
