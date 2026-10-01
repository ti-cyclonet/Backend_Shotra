-- Evaluaciones por rol: criterios distintos para ofertante y solicitante,
-- reputación separada por rol y calificación a ciegas (ver src/ratings/).

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RATING_REVEALED';

CREATE TYPE "RatingRole" AS ENUM ('PROVIDER', 'REQUESTER');

-- ratings: rol del evaluado, criterios nuevos y revelado
ALTER TABLE "ratings"
  ADD COLUMN "targetRole" "RatingRole",
  ADD COLUMN "wouldRepeat" BOOLEAN,
  ADD COLUMN "priceFairness" INTEGER,
  ADD COLUMN "clarity" INTEGER,
  ADD COLUMN "payment" INTEGER,
  ADD COLUMN "respect" INTEGER,
  ADD COLUMN "access" INTEGER,
  ADD COLUMN "revealedAt" TIMESTAMP(3);

UPDATE "ratings" r
SET "targetRole" = CASE WHEN r."targetId" = c."providerId" THEN 'PROVIDER'::"RatingRole" ELSE 'REQUESTER'::"RatingRole" END
FROM "service_contracts" c
WHERE c."id" = r."contractId";

-- Las evaluaciones existentes ya eran visibles
UPDATE "ratings" SET "revealedAt" = "createdAt";

-- Antes el ofertante calificaba al solicitante con criterios de ofertante
-- (calidad/puntualidad/comunicación): no significan nada para un solicitante.
UPDATE "ratings" SET "quality" = NULL, "punctuality" = NULL, "communication" = NULL
WHERE "targetRole" = 'REQUESTER';

ALTER TABLE "ratings" ALTER COLUMN "targetRole" SET NOT NULL;

CREATE INDEX "ratings_targetId_targetRole_idx" ON "ratings"("targetId", "targetRole");

-- user_profiles: reputación por rol
ALTER TABLE "user_profiles"
  ADD COLUMN "providerRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "providerRatingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "providerRepeatRate" DOUBLE PRECISION,
  ADD COLUMN "providerCriteria" JSONB,
  ADD COLUMN "requesterRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "requesterRatingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "requesterRepeatRate" DOUBLE PRECISION,
  ADD COLUMN "requesterCriteria" JSONB;

UPDATE "user_profiles" p
SET "providerRating" = ROUND(a.avg_score::numeric, 1),
    "providerRatingCount" = a.n,
    "providerCriteria" = jsonb_strip_nulls(jsonb_build_object(
      'quality', ROUND(a.quality::numeric, 1),
      'punctuality', ROUND(a.punctuality::numeric, 1),
      'communication', ROUND(a.communication::numeric, 1)))
FROM (
  SELECT "targetId", COUNT(*)::int AS n, AVG("score") AS avg_score,
         AVG("quality") AS quality, AVG("punctuality") AS punctuality, AVG("communication") AS communication
  FROM "ratings" WHERE "targetRole" = 'PROVIDER' GROUP BY "targetId"
) a
WHERE p."id" = a."targetId";

UPDATE "user_profiles" p
SET "requesterRating" = ROUND(a.avg_score::numeric, 1),
    "requesterRatingCount" = a.n
FROM (
  SELECT "targetId", COUNT(*)::int AS n, AVG("score") AS avg_score
  FROM "ratings" WHERE "targetRole" = 'REQUESTER' GROUP BY "targetId"
) a
WHERE p."id" = a."targetId";

-- completedJobs ahora cuenta todo servicio completado (antes solo si ambos calificaban)
UPDATE "user_profiles" p
SET "completedJobs" = COALESCE((
  SELECT COUNT(*) FROM "service_contracts" c
  WHERE c."providerId" = p."id" AND c."status" IN ('COMPLETED', 'EVALUATED')
), 0);
