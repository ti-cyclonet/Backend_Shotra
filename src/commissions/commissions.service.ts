import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type PlanKey = 'FREE' | 'PRO';

export interface CommissionCalcResult {
  ratePercent: number;
  commissionAmount: number;
  netAmount: number; // lo que recibe el ofertante = gross - commission
}

/** 'YYYY-MM' del momento dado (default ahora) */
export function periodKeyOf(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class CommissionsService {
  private readonly logger = new Logger(CommissionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcula la comisión para un servicio segun el plan del ofertante y el monto.
   * Busca la regla aplicable (planKey + rango de monto) y aplica tope maxFee/minFee.
   * Si no hay regla configurada, usa un fallback conservador (FREE 10%).
   */
  async calculate(planKey: PlanKey, grossAmount: number): Promise<CommissionCalcResult> {
    const rule = await this.prisma.commissionRule.findFirst({
      where: {
        planKey,
        active: true,
        minAmount: { lte: grossAmount },
        OR: [{ maxAmount: null }, { maxAmount: { gte: grossAmount } }],
      },
      orderBy: [{ priority: 'desc' }, { minAmount: 'desc' }],
    });

    const ratePercent = rule?.ratePercent ?? (planKey === 'PRO' ? 5 : 10);
    const minFee = rule?.minFee ?? 0;
    const maxFee = rule?.maxFee ?? null;

    let commissionAmount = Math.round((grossAmount * ratePercent) / 100);
    if (minFee > 0 && commissionAmount < minFee) commissionAmount = minFee;
    if (maxFee != null && commissionAmount > maxFee) commissionAmount = maxFee;
    // La comision nunca puede exceder el monto del servicio
    if (commissionAmount > grossAmount) commissionAmount = grossAmount;

    return {
      ratePercent,
      commissionAmount,
      netAmount: Math.max(0, grossAmount - commissionAmount),
    };
  }

  /**
   * Registra (devenga) el cargo de comision para un contrato completado.
   * Idempotente: un solo CommissionCharge por contrato.
   */
  async accrueForContract(params: {
    contractId: string;
    providerId: string;
    grossAmount: number;
    planKey: PlanKey;
    completedAt?: Date;
  }) {
    const existing = await this.prisma.commissionCharge.findUnique({
      where: { contractId: params.contractId },
    });
    if (existing) {
      this.logger.log(`Commission charge already exists for contract ${params.contractId}`);
      return existing;
    }

    const calc = await this.calculate(params.planKey, params.grossAmount);
    const periodKey = periodKeyOf(params.completedAt ?? new Date());

    const charge = await this.prisma.commissionCharge.create({
      data: {
        contractId: params.contractId,
        providerId: params.providerId,
        grossAmount: params.grossAmount,
        ratePercent: calc.ratePercent,
        commissionAmount: calc.commissionAmount,
        periodKey,
        status: 'ACCRUED',
      },
    });

    this.logger.log(
      `Accrued commission ${calc.commissionAmount} (${calc.ratePercent}%) for contract ${params.contractId} in ${periodKey}`,
    );
    return charge;
  }

  /**
   * Estado de cuenta del ofertante autenticado.
   * Resume: comisiones devengadas (pendientes de facturar), facturadas
   * (pendientes de pago) y pagadas, mas el detalle de cargos recientes.
   */
  async statement(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { authorizaUserId: userId } });
    if (!profile) {
      return { accruedTotal: 0, invoicedTotal: 0, paidTotal: 0, currentPeriodKey: periodKeyOf(), charges: [] };
    }

    const charges = await this.prisma.commissionCharge.findMany({
      where: { providerId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        // el contrato para mostrar el servicio asociado
      },
    });

    const sumBy = (status: string) =>
      charges.filter((c) => c.status === status).reduce((s, c) => s + c.commissionAmount, 0);

    const accruedTotal = sumBy('ACCRUED');
    const invoicedTotal = sumBy('INVOICED');
    const paidTotal = sumBy('PAID');

    // Enriquecer con el titulo del servicio (contrato -> request)
    const contractIds = charges.map((c) => c.contractId);
    const contracts = await this.prisma.serviceContract.findMany({
      where: { id: { in: contractIds } },
      select: { id: true, code: true, request: { select: { title: true } } },
    });
    const contractMap = new Map(contracts.map((c) => [c.id, c]));

    return {
      currentPeriodKey: periodKeyOf(),
      accruedTotal,   // pendiente de facturar (se acumula hasta $12.000)
      invoicedTotal,  // facturado, pendiente de pago
      paidTotal,      // ya pagado
      billingThreshold: 12000,
      charges: charges.map((c) => ({
        id: c.id,
        contractId: c.contractId,
        contractCode: contractMap.get(c.contractId)?.code ?? null,
        serviceTitle: contractMap.get(c.contractId)?.request?.title ?? null,
        grossAmount: c.grossAmount,
        ratePercent: c.ratePercent,
        commissionAmount: c.commissionAmount,
        periodKey: c.periodKey,
        status: c.status,
        invoicedPeriodKey: c.invoicedPeriodKey,
        createdAt: c.createdAt,
        paidAt: c.paidAt,
      })),
    };
  }
}
