-- Pedidos en ruta: el ofertante publica un trayecto y Shotra le cruza los
-- domicilios que quedan sobre él (ver src/routes).

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PackageSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- CreateEnum
CREATE TYPE "RouteMatchStatus" AS ENUM ('SUGGESTED', 'DISMISSED', 'PROPOSED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ROUTE_MATCH';

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "packageSize" "PackageSize";

-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "routeId" TEXT;

-- CreateTable
CREATE TABLE "provider_routes" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "originLatitude" DOUBLE PRECISION NOT NULL,
    "originLongitude" DOUBLE PRECISION NOT NULL,
    "originAddress" TEXT,
    "destLatitude" DOUBLE PRECISION NOT NULL,
    "destLongitude" DOUBLE PRECISION NOT NULL,
    "destAddress" TEXT,
    "geom" geography(LineString,4326),
    "distanceM" INTEGER NOT NULL,
    "durationS" INTEGER NOT NULL,
    "departAt" TIMESTAMP(3) NOT NULL,
    "arriveAt" TIMESTAMP(3) NOT NULL,
    "corridorM" INTEGER NOT NULL DEFAULT 600,
    "maxDetourM" INTEGER NOT NULL DEFAULT 2000,
    "maxDetourS" INTEGER NOT NULL DEFAULT 600,
    "maxPackageSize" "PackageSize" NOT NULL DEFAULT 'SMALL',
    "maxOrders" INTEGER NOT NULL DEFAULT 3,
    "status" "RouteStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastPushAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_matches" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "pickupFraction" DOUBLE PRECISION NOT NULL,
    "dropoffFraction" DOUBLE PRECISION NOT NULL,
    "detourM" INTEGER,
    "detourS" INTEGER,
    "etaPickupAt" TIMESTAMP(3) NOT NULL,
    "status" "RouteMatchStatus" NOT NULL DEFAULT 'SUGGESTED',
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_routes_status_departAt_idx" ON "provider_routes"("status", "departAt");

-- CreateIndex
CREATE INDEX "provider_routes_providerId_status_idx" ON "provider_routes"("providerId", "status");

-- CreateIndex
CREATE INDEX "route_matches_routeId_status_idx" ON "route_matches"("routeId", "status");

-- CreateIndex
CREATE INDEX "route_matches_requestId_idx" ON "route_matches"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "route_matches_routeId_requestId_key" ON "route_matches"("routeId", "requestId");

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "provider_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_routes" ADD CONSTRAINT "provider_routes_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_matches" ADD CONSTRAINT "route_matches_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "provider_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_matches" ADD CONSTRAINT "route_matches_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Búsqueda espacial de rutas que pasan cerca de una recogida/entrega
-- (ST_DWithin sobre geography). Prisma no genera índices GIST.
CREATE INDEX "provider_routes_geom_gist" ON "provider_routes" USING GIST ("geom");
