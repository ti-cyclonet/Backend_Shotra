-- =============================================================================
-- RESET COMPLETO — ShotraDB   (schema: public)
-- =============================================================================
-- ⚠️  DESTRUCTIVO E IRREVERSIBLE. Borra TODA la estructura y datos de Shotra.
--
-- ORM: Prisma con MIGRACIONES + extensión PostGIS. El esquema se reconstruye
--      aplicando las migraciones (prisma migrate deploy) y luego el seed recrea
--      las categorías de servicio y las reglas de comisión.
--
-- IMPORTANTE: Shotra SÍ usa PostGIS (schema.prisma → extensions = [postgis]).
--      Por eso, tras el DROP hay que RECREAR la extensión con
--      CREATE EXTENSION postgis; de lo contrario las migraciones fallan.
--
-- Verifica primero que estás en la base correcta:
--     SELECT current_database();   -- debe decir ShotraDB
-- =============================================================================

-- Borra TODAS las tablas, tipos/enums e historial de migraciones de Shotra.
-- (También borra las tablas de PostGIS; se recrean con CREATE EXTENSION.)
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Recrear la extensión PostGIS que el esquema necesita.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Verificación: debe listar solo tablas de PostGIS (p. ej. spatial_ref_sys).
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Después de este SQL, reconstruye con migraciones + seed (ver README.md):
--   docker exec cyclonet-shotra-api npx prisma migrate deploy
--   docker exec cyclonet-shotra-api npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
