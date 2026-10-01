import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reputación por rol.
 *
 * - El solicitante califica al OFERTANTE con criterios del trabajo (calidad,
 *   puntualidad, comunicación, precio respetado).
 * - El ofertante califica al SOLICITANTE con criterios del cliente (claridad de
 *   la solicitud, pago, trato, acceso/condiciones).
 * - Ambos responden "¿lo/le volverías a contratar/trabajar?" (wouldRepeat).
 *
 * Los agregados se guardan en UserProfile y solo cuentan evaluaciones reveladas
 * (calificación a ciegas, ver rating-reveal.service.ts).
 */
export type RatingRole = 'PROVIDER' | 'REQUESTER';

export const CRITERIA: Record<RatingRole, readonly string[]> = {
  PROVIDER: ['quality', 'punctuality', 'communication', 'priceFairness'],
  REQUESTER: ['clarity', 'payment', 'respect', 'access'],
};

/** Días que tienen las partes para calificar tras completar el servicio. */
export const RATING_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function ratingDeadline(completedAt: Date | null | undefined): Date | null {
  return completedAt ? new Date(completedAt.getTime() + RATING_WINDOW_DAYS * DAY_MS) : null;
}

/**
 * Promedio bayesiano: acerca el promedio a una media "prior" mientras haya
 * pocas evaluaciones, para que 1 sola de 5.0 no supere a 40 de 4.8.
 */
const PRIOR_MEAN = 4.0;
const PRIOR_WEIGHT = 5;
export function bayesianScore(avg: number, count: number): number {
  return (PRIOR_WEIGHT * PRIOR_MEAN + avg * count) / (PRIOR_WEIGHT + count);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Recalcula los agregados de un perfil (ambos roles + promedio global). */
export async function recomputeReputation(prisma: PrismaService, profileId: string) {
  const ratings = await prisma.rating.findMany({
    where: { targetId: profileId, revealedAt: { not: null } },
  });

  const summarize = (role: RatingRole) => {
    const list = ratings.filter((r) => r.targetRole === role);
    const avg = (vals: number[]) => (vals.length ? round1(vals.reduce((s, v) => s + v, 0) / vals.length) : null);
    const criteria: Record<string, number> = {};
    for (const key of CRITERIA[role]) {
      const v = avg(list.map((r) => (r as any)[key]).filter((x): x is number => typeof x === 'number'));
      if (v !== null) criteria[key] = v;
    }
    const answered = list.filter((r) => r.wouldRepeat !== null);
    return {
      rating: avg(list.map((r) => r.score)) ?? 0,
      count: list.length,
      repeatRate: answered.length ? round2(answered.filter((r) => r.wouldRepeat).length / answered.length) : null,
      criteria: Object.keys(criteria).length ? criteria : undefined,
    };
  };

  const p = summarize('PROVIDER');
  const q = summarize('REQUESTER');
  const all = ratings.map((r) => r.score);

  await prisma.userProfile.update({
    where: { id: profileId },
    data: {
      averageRating: all.length ? round1(all.reduce((s, v) => s + v, 0) / all.length) : 0,
      totalRatings: all.length,
      providerRating: p.rating,
      providerRatingCount: p.count,
      providerRepeatRate: p.repeatRate,
      providerCriteria: p.criteria ?? Prisma.DbNull,
      requesterRating: q.rating,
      requesterRatingCount: q.count,
      requesterRepeatRate: q.repeatRate,
      requesterCriteria: q.criteria ?? Prisma.DbNull,
    },
  });
}

/** Campos de UserProfile necesarios para resumir la reputación de un ofertante. */
export const PROVIDER_REPUTATION_SELECT = {
  completedJobs: true,
  providerRating: true,
  providerRatingCount: true,
  providerRepeatRate: true,
  providerCriteria: true,
} as const;

export const REQUESTER_REPUTATION_SELECT = {
  requesterRating: true,
  requesterRatingCount: true,
  requesterRepeatRate: true,
  requesterCriteria: true,
} as const;

/** Mínimo de evaluaciones para otorgar una insignia (evita insignias por 1 voto). */
const BADGE_MIN_COUNT = 3;
const BADGE_MIN_SCORE = 4.7;

const PROVIDER_BADGES: Record<string, string> = {
  quality: 'Trabajo de calidad',
  punctuality: 'Muy puntual',
  communication: 'Buena comunicación',
  priceFairness: 'Respeta el precio',
};
const REQUESTER_BADGES: Record<string, string> = {
  clarity: 'Solicitudes claras',
  payment: 'Paga a tiempo',
  respect: 'Excelente trato',
  access: 'Facilita el trabajo',
};

function badgesFor(
  criteria: unknown,
  count: number,
  repeatRate: number | null | undefined,
  labels: Record<string, string>,
  repeatLabel: string,
): string[] {
  if (count < BADGE_MIN_COUNT) return [];
  const c = (criteria as Record<string, number>) || {};
  const out = Object.entries(labels).filter(([k]) => (c[k] ?? 0) >= BADGE_MIN_SCORE).map(([, label]) => label);
  if ((repeatRate ?? 0) >= 0.9) out.unshift(repeatLabel);
  return out;
}

export interface ReputationSummary {
  rating: number;
  count: number;
  repeatRate: number | null;
  criteria: Record<string, number>;
  badges: string[];
  /** Puntaje para ordenar (promedio bayesiano). */
  score: number;
}

export function providerReputation(p: {
  providerRating: number;
  providerRatingCount: number;
  providerRepeatRate: number | null;
  providerCriteria: unknown;
}): ReputationSummary {
  return {
    rating: p.providerRating,
    count: p.providerRatingCount,
    repeatRate: p.providerRepeatRate,
    criteria: (p.providerCriteria as Record<string, number>) || {},
    badges: badgesFor(p.providerCriteria, p.providerRatingCount, p.providerRepeatRate, PROVIDER_BADGES, 'Lo recontratarían'),
    score: round2(bayesianScore(p.providerRating, p.providerRatingCount)),
  };
}

export function requesterReputation(p: {
  requesterRating: number;
  requesterRatingCount: number;
  requesterRepeatRate: number | null;
  requesterCriteria: unknown;
}): ReputationSummary {
  return {
    rating: p.requesterRating,
    count: p.requesterRatingCount,
    repeatRate: p.requesterRepeatRate,
    criteria: (p.requesterCriteria as Record<string, number>) || {},
    badges: badgesFor(p.requesterCriteria, p.requesterRatingCount, p.requesterRepeatRate, REQUESTER_BADGES, 'Le volverían a trabajar'),
    score: round2(bayesianScore(p.requesterRating, p.requesterRatingCount)),
  };
}
