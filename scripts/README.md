# Reset completo de la base de datos — Shotra

Script para **resetear por completo** la base de datos de Shotra y reconstruirla
con las migraciones de Prisma + el seed.

> ⚠️ **Operación destructiva e irreversible.** Borra todos los perfiles,
> solicitudes, propuestas, contratos, mensajes y comisiones. En producción,
> idealmente con respaldo previo.

## Cómo funciona

Shotra usa **Prisma con migraciones** (`prisma/migrations/`) y la extensión
**PostGIS** (`schema.prisma` → `extensions = [postgis]`).

- El **esquema** se reconstruye aplicando las migraciones con
  `prisma migrate deploy`.
- Los **datos base** (categorías de servicio y reglas de comisión) los recrea el
  **seed** (`prisma/seed.ts`), que es idempotente.
- Como usa **PostGIS**, tras dropear el esquema hay que **recrear la extensión**
  (`CREATE EXTENSION postgis`) antes de migrar; si no, las migraciones fallan.

Reset de **3 pasos**: limpiar esquema + recrear PostGIS (SQL), migrar, y seedear.

## Archivos

- `reset-database.sql` — `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
  seguido de `CREATE EXTENSION IF NOT EXISTS postgis;`.

## Pasos

### 1. Ejecutar el SQL (TablePlus o psql)

Conéctate a la base de **Shotra** y **verifica primero**:

```sql
SELECT current_database();   -- debe decir ShotraDB (o shotra_staging en staging)
```

Ejecuta el contenido de `reset-database.sql`. Para confirmar que quedó limpia:

```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public';
-- debe listar solo tablas de PostGIS (p. ej. spatial_ref_sys)
```

### 2. Reconstruir el esquema con las migraciones

En el servidor (EC2), dentro del contenedor:

```bash
docker exec cyclonet-shotra-api npx prisma migrate deploy
```

### 3. Ejecutar el seed (categorías + reglas de comisión)

El contenedor de producción corre el seed con `ts-node`, pero Node 20 falla al
cargar el `.ts` como ESM. Usa el comando que fuerza CommonJS (comprobado):

```bash
docker exec cyclonet-shotra-api npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
```

> En **local** (con el `.env` apuntando a la base local/staging) el seed normal
> funciona sin el truco: `npx prisma db seed`.

Al terminar deberías ver la categoría `Delivery` con 8 subcategorías y las reglas
`FREE 10%` / `PRO 5%`.

## Verificación

```sql
SELECT (SELECT COUNT(*) FROM service_categories) AS categorias,
       (SELECT COUNT(*) FROM commission_rules)   AS reglas,
       (SELECT COUNT(*) FROM user_profiles)      AS perfiles;
-- esperado: categorias = 9, reglas = 2, perfiles = 0
```

Tras el reset, los usuarios deben **iniciar sesión** de nuevo para que el backend
regenere su perfil.

## Entornos

| Entorno | Base de datos | Contenedor / ejecución |
|---|---|---|
| Producción | `ShotraDB` | `cyclonet-shotra-api` |
| Staging | `shotra_staging` | local con `.env` de staging (`npx prisma migrate deploy` + `npx prisma db seed`) |
