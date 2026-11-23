/**
 * Reglas puras de "pedidos en ruta" (sin BD ni red): qué solicitud le sirve a
 * qué ruta. El filtro espacial lo hace PostGIS (route-matcher.service.ts);
 * aquí va todo lo demás, para poder probarlo aislado.
 */

export type PackageSize = 'SMALL' | 'MEDIUM' | 'LARGE';

const PACKAGE_RANK: Record<PackageSize, number> = { SMALL: 0, MEDIUM: 1, LARGE: 2 };

/** El paquete cabe en lo que lleva la ruta. Sin tamaño declarado = SMALL. */
export function fitsPackage(requestSize: PackageSize | null | undefined, routeMax: PackageSize): boolean {
  return PACKAGE_RANK[requestSize || 'SMALL'] <= PACKAGE_RANK[routeMax];
}

/** Rutas activas a la vez según el plan del ofertante (deriva del rol en Authoriza). */
export function activeRouteLimit(plan: string | null | undefined): number {
  return plan === 'PRO' ? 3 : 1;
}

/**
 * Cuánto se aparta el ofertante de su camino. La app ofrece tres niveles en
 * vez de pedir metros: corredor de búsqueda alrededor de la ruta y desvío
 * máximo real (distancia y tiempo, el que se cumpla primero).
 */
export const DETOUR_PRESETS = {
  SHORT: { corridorM: 300, maxDetourM: 1000, maxDetourS: 300 },
  MEDIUM: { corridorM: 600, maxDetourM: 2000, maxDetourS: 600 },
  WIDE: { corridorM: 1000, maxDetourM: 4000, maxDetourS: 1200 },
} as const;
export type DetourPreset = keyof typeof DETOUR_PRESETS;

/** Hora estimada en que el ofertante pasa por la recogida (sin contar el desvío). */
export function etaAt(departAt: Date, durationS: number, fraction: number): Date {
  const f = Math.min(1, Math.max(0, fraction));
  return new Date(departAt.getTime() + f * durationS * 1000);
}

const MIN = 60 * 1000;
/** Tolerancia entre la hora pedida y la hora en que el ofertante pasa. */
export const SCHEDULE_TOLERANCE_MS = 60 * MIN;
/** Urgente sin fecha: el ofertante debe pasar por la recogida en esta ventana. */
export const URGENT_WINDOW_MS = 90 * MIN;
/** Sin fecha ni urgencia y sin vencimiento: ventana por defecto. */
export const DEFAULT_WINDOW_MS = 24 * 60 * MIN;

/**
 * La hora en que el ofertante pasa por la recogida sirve para la solicitud.
 * - Con fecha de servicio: ± 1 h.
 * - Urgente sin fecha: entre ahora y ahora + 90 min.
 * - Sin fecha: entre ahora y el vencimiento de la publicación (o 24 h).
 */
export function timeWindowOk(
  req: { scheduledAt: Date | null; isUrgent: boolean; expiresAt: Date | null },
  etaPickup: Date,
  now: Date = new Date(),
): boolean {
  const eta = etaPickup.getTime();
  if (req.scheduledAt) return Math.abs(req.scheduledAt.getTime() - eta) <= SCHEDULE_TOLERANCE_MS;
  // Se tolera haber salido hace poco (la ruta se compara con la hora declarada)
  if (eta < now.getTime() - 15 * MIN) return false;
  if (req.isUrgent) return eta <= now.getTime() + URGENT_WINDOW_MS;
  const limit = req.expiresAt ? req.expiresAt.getTime() : now.getTime() + DEFAULT_WINDOW_MS;
  return eta <= limit;
}

/**
 * El desvío real cabe en lo que aceptó el ofertante. Sin dato de OSRM (null)
 * se acepta: el filtro geométrico ya lo dejó dentro del corredor, y es mejor
 * una sugerencia aproximada que ninguna.
 */
export function detourOk(
  route: { maxDetourM: number; maxDetourS: number },
  detour: { detourM: number | null; detourS: number | null },
): boolean {
  if (detour.detourM == null || detour.detourS == null) return true;
  return detour.detourM <= route.maxDetourM && detour.detourS <= route.maxDetourS;
}

/** Throttle de push: uno por ruta cada 10 min; las demás coincidencias quedan en la lista. */
export const PUSH_THROTTLE_MS = 10 * MIN;
export function canPush(lastPushAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !lastPushAt || now.getTime() - lastPushAt.getTime() >= PUSH_THROTTLE_MS;
}

/** Estados de contrato que ocupan un cupo de la ruta (el pedido aún no se entrega). */
export const ROUTE_BUSY_CONTRACT = ['PENDING', 'SIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION'] as const;

/** La salida declarada es razonable: no más de 15 min en el pasado ni más de 7 días adelante. */
export function departAtValid(departAt: Date, now: Date = new Date()): boolean {
  const t = departAt.getTime();
  if (Number.isNaN(t)) return false;
  return t >= now.getTime() - 15 * MIN && t <= now.getTime() + 7 * 24 * 60 * MIN;
}

/** Texto corto del desvío para el push y la lista ("+800 m · +4 min"). */
export function detourLabel(detourM: number | null, detourS: number | null): string {
  if (detourM == null || detourS == null) return 'sobre tu ruta';
  const dist = detourM < 1000 ? `${Math.max(0, Math.round(detourM / 50) * 50)} m` : `${(detourM / 1000).toFixed(1)} km`;
  const mins = Math.max(0, Math.round(detourS / 60));
  return `+${dist} · +${mins} min`;
}
