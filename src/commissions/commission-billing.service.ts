import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizaClient } from './authoriza.client';
import { periodKeyOf } from './commissions.service';

const BILLING_THRESHOLD = 12000; // umbral minimo para emitir factura acumulada (COP)
const PAYDAY = 1;                 // dia de pago (equivalente al resto de CycloNet)
const DUE_DAYS_AFTER_PAYDAY = 7;  // vencimiento = payday + 7 (como Authoriza)

@Injectable()
export class CommissionBillingService {
  private readonly logger = new Logger(CommissionBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authoriza: AuthorizaClient,
  ) {}

  /**
   * Corte mensual: se ejecuta 5 dias antes del dia 1 (payday-5).
   * Como payday = 1, el corte cae los dias 26/27/28 segun el mes.
   * El cron corre diario a medianoche y solo actua el dia de corte.
   */
  @Cron('0 0 * * *')
  async monthlyCutoffCron() {
    if (!this.isCutoffDay(new Date())) return;
    this.logger.log('Ejecutando corte mensual de comisiones (payday-5)...');
    await this.runCutoff();
  }

  /** true si hoy es (dia 1 del proximo mes) - 5 dias */
  private isCutoffDay(today: Date): boolean {
    const firstOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, PAYDAY);
    const cutoff = new Date(firstOfNextMonth);
    cutoff.setDate(cutoff.getDate() - 5);
    return (
      today.getFullYear() === cutoff.getFullYear() &&
      today.getMonth() === cutoff.getMonth() &&
      today.getDate() === cutoff.getDate()
    );
  }

  /**
   * Ejecuta el corte: por cada ofertante con cargos ACCRUED, suma el acumulado.
   * Si supera el umbral, crea (lazy) el contrato de comisiones y emite una
   * factura acumulada en Authoriza; marca los cargos como INVOICED.
   * Si no supera el umbral, deja los cargos ACCRUED para el proximo periodo.
   */
  async runCutoff(now: Date = new Date()) {
    const invoicedPeriodKey = periodKeyOf(now);

    // Agrupar cargos devengados por ofertante
    const accrued = await this.prisma.commissionCharge.findMany({
      where: { status: 'ACCRUED' },
      include: { provider: true },
    });

    const byProvider = new Map<string, typeof accrued>();
    for (const c of accrued) {
      if (!byProvider.has(c.providerId)) byProvider.set(c.providerId, [] as any);
      byProvider.get(c.providerId)!.push(c);
    }

    let invoicedProviders = 0;
    let skipped = 0;

    for (const [providerId, charges] of byProvider) {
      const total = charges.reduce((sum, c) => sum + c.commissionAmount, 0);
      if (total < BILLING_THRESHOLD) {
        skipped++;
        this.logger.log(`Ofertante ${providerId}: acumulado ${total} < ${BILLING_THRESHOLD}, rueda al proximo mes`);
        continue;
      }

      try {
        const provider = charges[0].provider;
        const contractId = await this.ensureCommissionContract(provider);
        const invoice = await this.createMonthlyInvoice(provider.authorizaUserId, total, now);

        await this.prisma.commissionCharge.updateMany({
          where: { id: { in: charges.map((c) => c.id) } },
          data: {
            status: 'INVOICED',
            authorizaInvoiceId: String(invoice?.id ?? invoice?.invoiceId ?? ''),
            invoicedPeriodKey,
            invoicedAt: now,
          },
        });

        // guardar el contrato de comisiones si fue recien creado
        if (contractId && provider.authorizaCommissionContractId !== contractId) {
          await this.prisma.userProfile.update({
            where: { id: provider.id },
            data: { authorizaCommissionContractId: contractId },
          });
        }

        invoicedProviders++;
        this.logger.log(`Ofertante ${providerId}: factura ${invoice?.id} por ${total} emitida`);
      } catch (err: any) {
        this.logger.error(`Error facturando comisiones de ofertante ${providerId}: ${err.message}`);
      }
    }

    this.logger.log(`Corte completado. Facturados: ${invoicedProviders}, diferidos: ${skipped}`);
    return { invoicedProviders, skipped };
  }

  /** Crea (si no existe) el contrato de comisiones del ofertante en Authoriza. */
  private async ensureCommissionContract(provider: {
    id: string;
    authorizaUserId: string;
    authorizaCommissionContractId: string | null;
  }): Promise<string | null> {
    if (provider.authorizaCommissionContractId) return provider.authorizaCommissionContractId;

    const packageId = process.env.AUTHORIZA_SHOTRA_COMMISSION_PACKAGE_ID;
    if (!packageId) {
      this.logger.warn('AUTHORIZA_SHOTRA_COMMISSION_PACKAGE_ID no configurado; no se puede crear contrato de comisiones');
      return null;
    }

    const contract = await this.authoriza.createContract({
      userId: provider.authorizaUserId,
      packageId,
      value: 0, // valor variable; el monto real va en cada factura mensual
      mode: 'MONTHLY',
      payday: PAYDAY,
      startDate: new Date().toISOString().slice(0, 10),
      status: 'ACTIVE',
    });
    return String(contract?.id ?? '');
  }

  /** Crea la factura mensual acumulada en Authoriza para el ofertante. */
  private async createMonthlyInvoice(authorizaUserId: string, value: number, now: Date) {
    const issueDate = now.toISOString().slice(0, 10);
    // Vencimiento = dia 1 del proximo mes + 7 dias (payday + gracia)
    const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, PAYDAY);
    const expiration = new Date(firstOfNextMonth);
    expiration.setDate(expiration.getDate() + DUE_DAYS_AFTER_PAYDAY);

    return this.authoriza.createInvoice({
      value,
      issueDate,
      expirationDate: expiration.toISOString().slice(0, 10),
      userId: authorizaUserId,
      status: 'Issued',
    });
  }

  /**
   * Concilia el estado de pago: consulta las facturas de comisiones INVOICED en
   * Authoriza; si estan 'Paid', marca los cargos como PAID.
   * (Reemplazable por webhook cuando FactoNet/Authoriza lo tenga.)
   */
  @Cron('0 */2 * * *') // cada 2 horas
  async reconcilePaymentsCron() {
    await this.reconcilePayments();
  }

  async reconcilePayments() {
    const invoiced = await this.prisma.commissionCharge.findMany({
      where: { status: 'INVOICED', authorizaInvoiceId: { not: null } },
    });

    // Agrupar por factura para consultar una sola vez cada una
    const byInvoice = new Map<string, string[]>();
    for (const c of invoiced) {
      const inv = c.authorizaInvoiceId!;
      if (!byInvoice.has(inv)) byInvoice.set(inv, []);
      byInvoice.get(inv)!.push(c.id);
    }

    let paid = 0;
    for (const [invoiceId, chargeIds] of byInvoice) {
      try {
        const invoice = await this.authoriza.getInvoice(invoiceId);
        const status = invoice?.status ?? invoice?.estado;
        if (status === 'Paid') {
          await this.prisma.commissionCharge.updateMany({
            where: { id: { in: chargeIds } },
            data: { status: 'PAID', paidAt: new Date() },
          });
          paid += chargeIds.length;
        }
      } catch (err: any) {
        this.logger.warn(`No se pudo conciliar factura ${invoiceId}: ${err.message}`);
      }
    }

    if (paid > 0) this.logger.log(`Conciliacion: ${paid} cargos marcados como PAID`);
    return { paid };
  }
}
