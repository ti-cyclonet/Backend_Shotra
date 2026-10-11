import { BadRequestException } from '@nestjs/common';

/**
 * Reglas de una solicitud nueva según su categoría. Funciones puras
 * (request-validation.spec.ts).
 *
 * Delivery (categorías con requiresRoute: domicilios, mensajería, mudanzas…):
 * la dirección de destino es obligatoria. El domiciliario necesita saber a
 * dónde va para ofertar; antes se podía publicar sin ella (InOut publica los
 * domicilios de sus pedidos con la dirección que escribió el cliente).
 */
export function assertRequestRules(
  category: { requiresRoute?: boolean | null },
  dto: { address?: string | null; budgetMin?: number | null; budgetMax?: number | null },
): void {
  if (category.requiresRoute && (dto.address || '').trim().length < 5) {
    throw new BadRequestException('Escribe la dirección de entrega: es obligatoria para los domicilios.');
  }
  const min = dto.budgetMin;
  const max = dto.budgetMax;
  if ((min != null && min < 0) || (max != null && max < 0)) {
    throw new BadRequestException('El presupuesto no puede ser negativo.');
  }
  if (min != null && max != null && min > max) {
    throw new BadRequestException('El presupuesto mínimo no puede ser mayor que el máximo.');
  }
}
