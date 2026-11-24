# Design Document: Pedidos en ruta (Shotra)

## Overview

Hoy un domicilio en Shotra es **uno a uno**: el solicitante publica una
`ServiceRequest` con origen y destino (categorías con `requiresRoute`), los
ofertantes cercanos la ven en el listado (`GET /requests`, filtro por radio
calculado en JS con haversine), mandan una `Proposal`, se acepta y nace un
`ServiceContract`. Nadie sabe para dónde va el ofertante.

Este diseño agrega el escenario inverso: **el ofertante declara un trayecto que
ya va a hacer** ("salgo de Soledad hacia el Centro a las 3 pm") y Shotra le
ofrece las solicitudes cuya recogida y entrega quedan **sobre ese trayecto y en
el orden correcto**, con un desvío acotado. Para el cliente el beneficio es un
precio más bajo ("precio de paso": el ofertante ya iba para allá). Para el
ofertante, ganar algo extra en un viaje que igual iba a hacer.

El MVP usa **solo rutas declaradas, sin GPS en vivo**. El encadenamiento sobre
contratos en curso, las rutas recurrentes y el seguimiento en vivo quedan para
fases siguientes.

### Decisiones del MVP

Implementado con estos valores por defecto (2026-11-23). Siguen abiertos a
ajuste, ver "Preguntas abiertas".

| Tema | Propuesta MVP |
|---|---|
| Quién publica rutas | Cualquier perfil con `isProvider` y al menos una `ProviderSkill` en una categoría `requiresRoute` |
| Rutas activas por ofertante | FREE: 1 · PRO: 3 (incentivo al plan) |
| Corredor y desvío | Tres niveles que elige el ofertante (`detour`): `SHORT` 300 m / 1 km / 5 min · `MEDIUM` (default) 600 m / 2 km / 10 min · `WIDE` 1 km / 4 km / 20 min |
| Pedidos simultáneos por ruta | Hasta 3 contratos en curso ligados a la ruta |
| Precio | Libre, como hoy: el ofertante oferta. La app muestra el presupuesto del cliente y el desvío; no hay precio automático |
| Motor de rutas | OSRM. MVP con `OSRM_URL` configurable (por defecto el servidor público, como ya usa el frontend); antes de escalar, OSRM propio con el extracto de Colombia |
| Privacidad | El cliente nunca ve la ruta del ofertante; solo un conteo ("2 repartidores pasan por tu zona hoy") y la etiqueta "En ruta" en la oferta |

## Architecture

Todo vive en **Shotra** (`Backend_Shotra` + `Frontend-Shotra`). Authoriza y
FactoNet no cambian: la comisión de un contrato nacido de una ruta se devenga
igual que cualquier otro (confirmación en doble vía).

```
Ofertante (app)                            Backend_Shotra                         Solicitante (app)
───────────────                            ──────────────                         ─────────────────
1. Crear ruta (origen, destino, salida,
   desvío, tamaño máx.)  ──────────────── POST /routes
                                            · OSRM: geometría + duración
                                            · guarda LineString (geography)
                                            · busca solicitudes ya publicadas
   ◄── ruta + coincidencias actuales            que caen en la ruta (RouteMatch)
                                                                                  2. Publicar domicilio
                                          GET /routes/coverage  ◄──────────────── (pista: "2 pasan cerca")
                                          POST /requests        ◄────────────────
                                            · matcher: rutas ACTIVE compatibles
                                              (PostGIS → ventana de tiempo →
                                               OSRM desvío real, top 5)
                                            · RouteMatch + push ROUTE_MATCH
3. Push "Pedido en tu ruta: +800 m" ◄──────
   Ver detalle de ruta ────────────────── GET /routes/:id/matches
   Ofertar ────────────────────────────── POST /proposals { ..., routeId }
                                                                                  4. Ve oferta con
                                                                                     etiqueta "En ruta"
                                          (flujo actual: aceptar → contrato → firmas → entrega → confirmación)
Cron cada 15 min
   · vence rutas (arriveAt + 1 h < ahora) y sus coincidencias
   · vence coincidencias cuya solicitud ya no está PUBLISHED / IN_PROPOSALS
```

## Data Models

`prisma/schema.prisma` ya declara `extensions = [postgis]`, pero hoy no hay
ninguna columna geoespacial ni consultas crudas. Prisma no maneja `geography`
de forma nativa: la columna se declara `Unsupported(...)`, el índice GIST y la
escritura van en SQL crudo (`$executeRaw` / `$queryRaw`).

### `ProviderRoute` (nuevo)

```prisma
model ProviderRoute {
  id              String   @id @default(uuid())
  providerId      String
  provider        UserProfile @relation(fields: [providerId], references: [id])

  originLatitude  Float
  originLongitude Float
  originAddress   String?
  destLatitude    Float
  destLongitude   Float
  destAddress     String?

  // LineString de OSRM (overview=full). Se escribe con $executeRaw:
  // ST_SetSRID(ST_GeomFromGeoJSON($geojson), 4326)::geography
  geom            Unsupported("geography(LineString,4326)")?
  distanceM       Int      // distancia de la ruta base
  durationS       Int      // duración de la ruta base

  departAt        DateTime
  arriveAt        DateTime // departAt + durationS (calculado)

  corridorM       Int      @default(600)   // radio de búsqueda alrededor de la ruta
  maxDetourM      Int      @default(2000)
  maxDetourS      Int      @default(600)
  maxPackageSize  PackageSize @default(SMALL)
  maxOrders       Int      @default(3)

  status          RouteStatus @default(ACTIVE)
  matches         RouteMatch[]
  proposals       Proposal[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([status, departAt])
  @@index([providerId, status])
  @@map("provider_routes")
}

enum RouteStatus {
  ACTIVE      // publicada (antes o durante el viaje)
  COMPLETED   // el ofertante la cerró
  CANCELLED
  EXPIRED     // pasó arriveAt + 1 h sin cerrarla
}

enum PackageSize {
  SMALL   // cabe en un morral (documentos, comida, paquete pequeño)
  MEDIUM  // caja mediana, requiere parrilla/maletero
  LARGE   // requiere vehículo de carga
}
```

Migración SQL adicional (a mano en el archivo generado):

```sql
CREATE INDEX provider_routes_geom_gist ON provider_routes USING GIST (geom);
```

### `RouteMatch` (nuevo)

Una solicitud que cae en una ruta. Evita notificaciones duplicadas y alimenta
la pantalla "Pedidos en tu ruta".

```prisma
model RouteMatch {
  id              String   @id @default(uuid())
  routeId         String
  route           ProviderRoute @relation(fields: [routeId], references: [id], onDelete: Cascade)
  requestId       String
  request         ServiceRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)

  pickupFraction  Float    // 0..1, posición de la recogida sobre la ruta
  dropoffFraction Float
  detourM         Int?     // desvío real según OSRM (null = solo filtro geométrico)
  detourS         Int?
  etaPickupAt     DateTime // departAt + pickupFraction * durationS (+ desvío parcial)

  status          RouteMatchStatus @default(SUGGESTED)
  notifiedAt      DateTime?

  createdAt       DateTime @default(now())

  @@unique([routeId, requestId])
  @@index([routeId, status])
  @@map("route_matches")
}

enum RouteMatchStatus {
  SUGGESTED  // se muestra en la ruta
  DISMISSED  // el ofertante la descartó
  PROPOSED   // el ofertante ofertó desde la ruta
  EXPIRED    // la solicitud o la ruta ya no están vigentes
}
```

### Cambios a modelos existentes

| Modelo | Cambio | Uso |
|---|---|---|
| `ServiceRequest` | `packageSize PackageSize?` | Solo categorías `requiresRoute`. Null = SMALL para efectos del filtro |
| `ServiceRequest` | `routeMatches RouteMatch[]` | Relación inversa |
| `Proposal` | `routeId String?` + relación a `ProviderRoute` | Marca la oferta como "En ruta" y cuenta contra `maxOrders` |
| `UserProfile` | `routes ProviderRoute[]` | Relación inversa |
| `NotificationType` | `ROUTE_MATCH` | "Hay un pedido en tu ruta" (`entityType: 'route'`, `entityId: routeId`) |

Todas las columnas nuevas son opcionales: las solicitudes, ofertas y contratos
existentes no cambian de comportamiento.

## Matching

### 1. Filtro geométrico (PostGIS)

Al publicar una solicitud con origen y destino (o al crear una ruta, en sentido
inverso):

```sql
WITH p AS (
  SELECT ST_SetSRID(ST_MakePoint($pickLng, $pickLat), 4326) AS pick,
         ST_SetSRID(ST_MakePoint($dropLng, $dropLat), 4326) AS drop
)
SELECT r.id,
       ST_LineLocatePoint(r.geom::geometry, p.pick) AS pickup_fraction,
       ST_LineLocatePoint(r.geom::geometry, p.drop) AS dropoff_fraction
FROM provider_routes r, p
WHERE r.status = 'ACTIVE'
  AND r."providerId" <> $requesterProfileId
  AND r."arriveAt" > now()
  AND ST_DWithin(r.geom, p.pick::geography, r."corridorM")
  AND ST_DWithin(r.geom, p.drop::geography, r."corridorM")
  AND ST_LineLocatePoint(r.geom::geometry, p.pick)
    < ST_LineLocatePoint(r.geom::geometry, p.drop);
```

El orden de las fracciones garantiza que la recogida quede **antes** que la
entrega en el sentido del viaje.

### 2. Filtros de negocio (en el servicio)

- El ofertante tiene `ProviderSkill` en la categoría de la solicitud.
- `packageSize` de la solicitud ≤ `maxPackageSize` de la ruta.
- Ofertas en ruta aceptadas y en curso (`Proposal.routeId` con contrato no
  terminado) < `maxOrders`.
- **Ventana de tiempo**: `etaPickup = departAt + pickupFraction × durationS`.
  - Solicitud con `scheduledAt`: |`scheduledAt` − `etaPickup`| ≤ 60 min.
  - Solicitud `isUrgent` sin fecha: `etaPickup` ≤ ahora + 90 min.
  - Sin fecha ni urgencia: `etaPickup` antes de `expiresAt` (o 24 h).

### 3. Desvío real (OSRM)

Para los 5 mejores candidatos (menor distancia al corredor), una llamada a OSRM
con 4 puntos: `origen → recogida → entrega → destino`.

```
detourM = distance(origen, recogida, entrega, destino) − route.distanceM
detourS = duration(...) − route.durationS
```

Se descarta si supera `maxDetourM` o `maxDetourS`. Si OSRM falla o se demora
más de 3 s, se guarda la coincidencia con `detourM = null` (solo filtro
geométrico) y se notifica igual: es mejor una sugerencia aproximada que
ninguna.

### 4. Resultado

`RouteMatch` (upsert por `routeId + requestId`) y `notifications.notify({ type:
'ROUTE_MATCH', ... })`, que ya envía el push de Expo. **Máximo un push por ruta
cada 10 minutos**: las demás coincidencias quedan en la lista sin push.

El matcher corre **después** de responder el `POST /requests` (sin `await` en la
respuesta, con captura de errores). Si falla, la solicitud se publica igual.

## API

Módulo nuevo `src/routes/` (`RoutesModule`, `RoutesController`,
`RoutesService`, `RouteMatcherService`, `OsrmClient`).

| Método | Ruta | Quién | Qué hace |
|---|---|---|---|
| `POST` | `/routes` | ofertante | Crea la ruta: valida límites del plan, pide geometría a OSRM (400 si OSRM no responde: sin geometría no hay ruta), calcula `arriveAt`, busca solicitudes publicadas que caigan en ella |
| `GET` | `/routes/mine` | ofertante | Rutas activas y recientes, con conteo de coincidencias |
| `GET` | `/routes/:id` | dueño | Detalle con GeoJSON de la ruta (para dibujarla) |
| `GET` | `/routes/:id/matches` | dueño | Coincidencias `SUGGESTED`/`PROPOSED` con resumen de la solicitud, desvío y ETA |
| `PATCH` | `/routes/:id/matches/:matchId/dismiss` | dueño | Descarta una coincidencia |
| `PATCH` | `/routes/:id/complete` | dueño | Cierra la ruta (`COMPLETED`) |
| `PATCH` | `/routes/:id/cancel` | dueño | Cancela; no afecta contratos ya firmados |
| `GET` | `/routes/coverage?pickLat&pickLng&dropLat&dropLng&at` | solicitante | `{ count }` de rutas compatibles. Nunca devuelve rutas ni ofertantes |

Cambios en endpoints existentes:

- `POST /requests`: acepta `packageSize`; al terminar dispara el matcher.
- `POST /proposals`: acepta `routeId` opcional. Se valida que la ruta sea del
  ofertante, esté `ACTIVE` y tenga un `RouteMatch` para esa solicitud; el match
  pasa a `PROPOSED`.
- `GET /requests/:id` (vista del solicitante): cada oferta trae `viaRoute:
  boolean`, sin datos de la ruta.

### Cron (`@nestjs/schedule`, ya está en `app.module.ts`)

`RouteExpiryService`, cada 15 min:
- `ACTIVE` con `arriveAt + 1 h < now()` → `EXPIRED`.
- `RouteMatch` `SUGGESTED` cuya solicitud ya no está `PUBLISHED`/`IN_PROPOSALS`,
  o cuya ruta ya no está `ACTIVE` → `EXPIRED`.

### Configuración

| Variable | Default | Nota |
|---|---|---|
| `OSRM_URL` | `https://router.project-osrm.org` | El servidor público tiene límites de uso y no garantiza disponibilidad; sirve para el MVP con poco volumen. Ver Fase 3 |

Con el valor por defecto no hay que tocar nada en el EC2. Si se monta un OSRM
propio, recordar que el `.env` y el compose del servidor **no se sincronizan
con el repo**: `OSRM_URL` se agrega a mano en `/opt/cyclonet/deploy` (igual que
pasó con `INTERNAL_API_KEY`).

## Frontend (`Frontend-Shotra`)

Reutiliza el selector de puntos de `app/(tabs)/create.tsx` y el mapa Leaflet de
`src/components/routeMapHtml.ts` (que ya traza con OSRM).

**Ofertante**
1. **Mis rutas** (nueva sección en el perfil o en la pestaña de ofertante):
   lista de rutas activas con badge del número de coincidencias.
2. **Nueva ruta**: origen y destino en el mapa (por defecto, origen = ubicación
   actual), hora de salida (ahora / elegir), desvío aceptado (corto, medio,
   amplio → corredor y desvío máximo), tamaño máximo de paquete. Vista previa de
   la ruta antes de publicar.
3. **Detalle de ruta**: mapa con la ruta y marcadores de recogida y entrega de
   cada coincidencia; lista con "+800 m · +4 min · recoges ~3:20 pm ·
   presupuesto $8.000–$12.000". Acciones: **Ofertar** (pantalla actual de
   oferta, con `routeId`) y **Descartar**. Botones Cerrar y Cancelar ruta.
4. Push `ROUTE_MATCH` → abre el detalle de la ruta.

**Solicitante**
1. Al publicar un domicilio: selector de tamaño de paquete y, cuando hay
   origen y destino, una pista no bloqueante: "2 repartidores pasan cerca hoy;
   tu pedido les llega directo".
2. En las ofertas recibidas: etiqueta **En ruta** ("va de camino, por eso
   puede cobrarte menos").

## Extensión en InOut ("Domicilios con Shotra")

InOut publica los domicilios de sus pedidos en Shotra con el **mismo
`POST /requests`**, usando el token Shotra del comerciante (`switch-app`). Por
eso el matcher los cubre sin cambios en el backend: un pedido de InOut con
recogida y entrega le llega como push a los domiciliarios que van de camino.

La condición es que la solicitud **tenga punto de recogida**. En InOut era
opcional (botón 📍) y el negocio no tiene coordenadas guardadas, así que la
mayoría de los domicilios salían sin recogida y no podían cruzarse con ninguna
ruta. Cambios en `Frontend_Inout` (`delivery-request.component` y
`shotra.service`):

- **Recogida recordada**: la última ubicación capturada con 📍 se guarda en
  `localStorage` (`shotra_last_pickup`) y se usa por defecto en el siguiente
  domicilio, con el aviso "la misma de tu último domicilio; si hoy sale de otro
  lugar, márcalo con 📍". Sin recogida, una pista invita a marcarla.
- **Tamaño del paquete** (`packageSize`), por defecto pequeño.
- **Pista de cobertura**: con recogida y entrega, consulta
  `GET /routes/coverage` (debounce de 600 ms; recalcula al cambiar tipo,
  fecha, urgencia o tamaño). Si hay domiciliarios en ruta, se muestra "N
  domiciliarios pasan cerca de esta ruta". Si la consulta falla, no se muestra
  nada.
- **Etiqueta "En ruta"** en las ofertas con `viaRoute`.

Pendiente (fase 2): guardar la ubicación de la tienda en la configuración del
negocio en InOut (o por sede) y mandarla siempre como recogida, en vez de
depender del navegador. También hay que agrupar varios pedidos de la misma
tienda hacia destinos cercanos en una sola ruta.

## Seguridad y confianza

- **Privacidad del ofertante**: la geometría solo la ve el dueño. `coverage`
  devuelve un número, sin ubicaciones. El solicitante conoce al ofertante
  solo al recibir su oferta, igual que hoy.
- **Contenido del paquete**: en categorías `requiresRoute`, el solicitante
  declara que no envía dinero en efectivo, armas, sustancias ni objetos de alto
  valor (casilla obligatoria). Lo mismo aplica al flujo de domicilios actual.
- **Rutas fantasma**: rutas que se publican y no se hacen. En el MVP vencen
  solas. Si se vuelve un problema, se puede contar cancelaciones de contratos
  nacidos de rutas en la reputación del ofertante.
- **Abuso del push**: máximo un push por ruta cada 10 min y límite de rutas
  activas por plan.

## Fases

| Fase | Alcance |
|---|---|
| **1. MVP** | Rutas declaradas, matching PostGIS + OSRM, push, ofertar desde la ruta, etiqueta "En ruta", cobertura para el solicitante |
| **2. Encadenamiento y recurrencia** | (a) Al aceptar un domicilio, el contrato en curso genera una ruta implícita (origen → destino del pedido) para que entren pedidos encadenados sin que el ofertante declare nada. (b) Rutas recurrentes ("L–V 7:00 Malambo → Zona Franca"): plantilla + cron que crea la ruta del día. (c) Código de entrega (OTP de 4 dígitos que el solicitante le da al receptor) |
| **3. En vivo y escala** | Ubicación en segundo plano durante contratos activos (`expo-location` + permisos de background en iOS y Android), ETA en vivo para el solicitante, OSRM propio en el host (contenedor `osrm-backend` con extracto de Colombia), precio sugerido según el desvío |

## Tareas (Fase 1)

### Backend_Shotra
- [x] Prisma: `ProviderRoute`, `RouteMatch`, enums `RouteStatus`,
      `RouteMatchStatus`, `PackageSize`; `ServiceRequest.packageSize`;
      `Proposal.routeId`; `NotificationType.ROUTE_MATCH`. Agregar a mano el
      índice GIST a la migración. Probar `migrate dev` contra staging
      (túnel SSH)
- [x] `OsrmClient`: `route(points[])` → `{ distanceM, durationS, geojson }`,
      timeout de 3 s, `OSRM_URL` en config
- [x] `RoutesService`: crear (límites FREE/PRO, geometría con `$executeRaw`),
      listar, detalle con `ST_AsGeoJSON`, completar, cancelar
- [x] `RouteMatcherService`: `matchRequest(requestId)` y
      `matchRoute(routeId)` con la consulta PostGIS, filtros de negocio,
      desvío OSRM (top 5), upsert de `RouteMatch`, push con throttle
- [x] Disparar `matchRequest` desde `RequestsService.create` y `republish`
      (no bloqueante)
- [x] `ProposalsService.create`: validar `routeId` y marcar el match
      `PROPOSED`; validar `maxOrders`
- [x] Verificar que nada impida a un ofertante tener varios contratos
      `SIGNED`/`IN_PROGRESS` a la vez (hoy no se ve una restricción; confirmar
      en `contracts.service.ts` y en el frontend)
- [x] `GET /routes/coverage`
- [x] `RouteExpiryService` (cron cada 15 min)
- [x] `viaRoute` en las ofertas que ve el solicitante
- [x] Verificado contra un PostGIS 16 desechable (migraciones completas +
      flujo de punta a punta con OSRM falso): orden recogida/entrega, fuera
      de corredor, ventana de tiempo, tamaño, sin repetir aviso, throttle,
      OSRM caído, cobertura, oferta desde la ruta, `viaRoute`, cerrar y
      vencer. Backend_Shotra no tiene jest: las pruebas no quedaron en el repo
- [ ] Probar contra staging (túnel SSH) con OSRM real
- [ ] Al retirar o rechazar una oferta "En ruta", devolver el match a
      `SUGGESTED` (hoy queda `PROPOSED`)

### Frontend_Inout (extensión "Domicilios con Shotra")
- [x] `packageSize`, recogida recordada, pista de cobertura, etiqueta "En ruta"
- [ ] Ubicación de la tienda en la configuración del negocio (fase 2)

### Frontend-Shotra
- [x] API client: `routes.*`, `packageSize` en crear solicitud, `routeId` en
      crear oferta
- [x] Pantallas: Mis rutas, Nueva ruta, Detalle de ruta (mapa + coincidencias)
- [x] `routeMapHtml`: dibujar una ruta desde GeoJSON del backend y marcadores
      de coincidencias
- [x] Publicar domicilio: tamaño de paquete y pista de cobertura
- [ ] Publicar domicilio: casilla de contenido permitido
- [x] Etiqueta "En ruta" en las ofertas; navegación del push `ROUTE_MATCH`
- [x] Verificado en web (celular y panel ancho) contra una API simulada
- [ ] Probar en un celular real contra el backend real

### Despliegue
- [ ] (Opcional) `OSRM_URL` en el `.env` del EC2, solo si se usa un OSRM propio
- [x] `Backend_Shotra` desplegado (#26, 2026-11-23) **antes** que los
      frontends: InOut (#465/#467) y la app (#44) mandan `packageSize`, que
      el backend viejo rechaza (`forbidNonWhitelisted`)
- [ ] Confirmar en producción: `SELECT postgis_full_version();` en RDS y
      publicar una ruta real desde la app (el deploy pasó, pero sin sesión
      la API responde 401 a todo y no se pudo comprobar `/routes`)

## Preguntas abiertas

1. ¿Límites de rutas activas por plan (1 FREE / 3 PRO) o igual para todos?
2. ¿Valores por defecto de corredor y desvío (600 m y 2 km / 10 min) para
   Barranquilla y su área metropolitana?
3. ¿Se publica la cobertura al solicitante desde el MVP, o se espera a tener
   suficientes rutas para no mostrar "0 repartidores" seguido?
4. ¿OSRM público para el MVP, o se monta el propio desde el arranque?
