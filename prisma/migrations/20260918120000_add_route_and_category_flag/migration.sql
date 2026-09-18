-- AlterTable
ALTER TABLE "service_categories" ADD COLUMN     "requiresRoute" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "originLatitude" DOUBLE PRECISION,
ADD COLUMN     "originLongitude" DOUBLE PRECISION,
ADD COLUMN     "originAddress" TEXT;
