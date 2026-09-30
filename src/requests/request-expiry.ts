/**
 * Vencimiento de publicaciones de SHOTRA.
 *
 * Una publicación abierta (PUBLISHED / IN_PROPOSALS) vence cuando:
 *  - NO_OFFERS:       no tiene ninguna oferta vigente (PENDING) y pasó su
 *                     `expiresAt` (48 h al publicar, 24 h si es urgente).
 *  - SCHEDULE_PASSED: tenía fecha de servicio (`scheduledAt`) y ya pasó (más
 *                     un margen): aunque tenga ofertas, ya no sirven.
 *  - STALE_OFFERS:    tiene ofertas pero el solicitante no eligió ninguna en
 *                     el plazo máximo (7 días desde que publicó).
 *
 * Los plazos se ajustan por variables de entorno. Estas funciones son puras
 * (sin base de datos) para poder probarlas.
 */

const HOUR = 60 * 60 * 1000;
const envNum = (name: string, def: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
};

export const expiryConfig = () => ({
  ttlHours: envNum('SHOTRA_REQUEST_TTL_HOURS', 48),
  urgentTtlHours: envNum('SHOTRA_REQUEST_URGENT_TTL_HOURS', 24),
  scheduleGraceHours: envNum('SHOTRA_SCHEDULE_GRACE_HOURS', 1),
  maxOpenDays: envNum('SHOTRA_REQUEST_MAX_OPEN_DAYS', 7),
});

export type ExpiryReason = 'NO_OFFERS' | 'SCHEDULE_PASSED' | 'STALE_OFFERS';

/**
 * Hasta cuándo una publicación sin ofertas sigue abierta: el plazo normal
 * (o urgente) y, si tiene fecha de servicio, nunca después de esa fecha.
 */
export function computeExpiresAt(from: Date, isUrgent: boolean, scheduledAt?: Date | null): Date {
  const cfg = expiryConfig();
  let at = from.getTime() + (isUrgent ? cfg.urgentTtlHours : cfg.ttlHours) * HOUR;
  if (scheduledAt) at = Math.min(at, scheduledAt.getTime() + cfg.scheduleGraceHours * HOUR);
  return new Date(Math.max(at, from.getTime() + HOUR)); // al menos 1 h para recibir ofertas
}

export interface ExpiryCandidate {
  status: string;
  createdAt: Date;
  expiresAt: Date | null;
  scheduledAt: Date | null;
  /** Ofertas vigentes (PENDING). */
  pendingProposals: number;
}

/** Por qué vence (o null si sigue abierta). */
export function expiryReason(r: ExpiryCandidate, now = new Date()): ExpiryReason | null {
  if (!['PUBLISHED', 'IN_PROPOSALS'].includes(r.status)) return null;
  const cfg = expiryConfig();
  const t = now.getTime();
  if (r.scheduledAt && r.scheduledAt.getTime() + cfg.scheduleGraceHours * HOUR <= t) return 'SCHEDULE_PASSED';
  if (r.pendingProposals === 0) {
    const deadline = r.expiresAt ?? computeExpiresAt(r.createdAt, false, r.scheduledAt);
    return deadline.getTime() <= t ? 'NO_OFFERS' : null;
  }
  return r.createdAt.getTime() + cfg.maxOpenDays * 24 * HOUR <= t ? 'STALE_OFFERS' : null;
}

/** Texto para el solicitante según el motivo. */
export function expiryMessage(title: string, reason: ExpiryReason): { title: string; body: string } {
  switch (reason) {
    case 'NO_OFFERS':
      return { title: 'Tu publicación venció sin ofertas', body: `«${title}» no recibió ofertas a tiempo. Puedes volver a publicarla desde Mis solicitudes.` };
    case 'SCHEDULE_PASSED':
      return { title: 'Tu publicación venció', body: `Ya pasó la fecha que pediste para «${title}». Si aún lo necesitas, vuelve a publicarla con una nueva fecha.` };
    case 'STALE_OFFERS':
      return { title: 'Tu publicación venció', body: `«${title}» tenía ofertas pero no elegiste ninguna a tiempo. Puedes volver a publicarla.` };
  }
}
