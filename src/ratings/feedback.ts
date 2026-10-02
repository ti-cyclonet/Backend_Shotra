/**
 * Comentarios que recibe una persona (opción B: anónimos y diferidos).
 *
 * La persona evaluada ve de inmediato sus promedios, criterios e insignias,
 * pero los comentarios le llegan SIN el nombre de quién los escribió y
 * agrupados, para que no pueda relacionar un comentario con un cliente:
 * - se liberan en grupos completos de BATCH_SIZE (en orden de revelado), y
 * - un comentario que no completa grupo se libera a los RELEASE_DAYS días.
 * Dentro de cada grupo el orden no sigue el tiempo (no se puede deducir quién).
 */
export const BATCH_SIZE = 3;
export const RELEASE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RevealedRating {
  id: string;
  score: number;
  comment: string | null;
  targetRole: string;
  revealedAt: Date;
}

export interface AnonymousFeedback {
  id: string;
  score: number;
  comment: string | null;
  targetRole: string;
}

/** Orden estable que no depende del tiempo (por id). */
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function releaseFeedback(ratings: RevealedRating[], now: Date = new Date()) {
  const ordered = [...ratings].sort((a, b) => a.revealedAt.getTime() - b.revealedAt.getTime());
  const fullBatches = Math.floor(ordered.length / BATCH_SIZE) * BATCH_SIZE;
  const cutoff = now.getTime() - RELEASE_DAYS * DAY_MS;

  const groups: RevealedRating[][] = [];
  for (let i = 0; i < fullBatches; i += BATCH_SIZE) groups.push(ordered.slice(i, i + BATCH_SIZE));
  // Los que no completan grupo: solo los que ya cumplieron el plazo
  const late = ordered.slice(fullBatches).filter((r) => r.revealedAt.getTime() <= cutoff);
  if (late.length) groups.push(late);

  const released = groups
    .reverse() // grupos más recientes primero
    .flatMap((g) => [...g].sort(byId))
    .map(({ id, score, comment, targetRole }) => ({ id, score, comment, targetRole }));

  return { released, pending: ordered.length - released.length };
}
