-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'NEQUI', 'DAVIPLATA', 'PSE', 'OTHER');

-- CreateEnum
CREATE TYPE "CommissionChargeStatus" AS ENUM ('ACCRUED', 'INVOICED', 'PAID', 'WAIVED');

-- AlterEnum
ALTER TYPE "ContractStatus" ADD VALUE 'PENDING_CONFIRMATION';

-- AlterTable
ALTER TABLE "service_contracts" ADD COLUMN     "providerCompletedAt" TIMESTAMP(3),
ADD COLUMN     "requesterConfirmedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "authorizaCommissionContractId" TEXT,
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'FREE';

-- CreateTable
CREATE TABLE "payment_declarations" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "voucherUrl" TEXT,
    "note" TEXT,
    "declaredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "minAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxAmount" DOUBLE PRECISION,
    "ratePercent" DOUBLE PRECISION NOT NULL,
    "minFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxFee" DOUBLE PRECISION,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_charges" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "ratePercent" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "periodKey" TEXT NOT NULL,
    "status" "CommissionChargeStatus" NOT NULL DEFAULT 'ACCRUED',
    "authorizaInvoiceId" TEXT,
    "invoicedPeriodKey" TEXT,
    "invoicedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_declarations_contractId_key" ON "payment_declarations"("contractId");

-- CreateIndex
CREATE INDEX "commission_rules_planKey_active_idx" ON "commission_rules"("planKey", "active");

-- CreateIndex
CREATE UNIQUE INDEX "commission_charges_contractId_key" ON "commission_charges"("contractId");

-- CreateIndex
CREATE INDEX "commission_charges_providerId_status_idx" ON "commission_charges"("providerId", "status");

-- CreateIndex
CREATE INDEX "commission_charges_status_periodKey_idx" ON "commission_charges"("status", "periodKey");

-- AddForeignKey
ALTER TABLE "payment_declarations" ADD CONSTRAINT "payment_declarations_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "service_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_charges" ADD CONSTRAINT "commission_charges_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
