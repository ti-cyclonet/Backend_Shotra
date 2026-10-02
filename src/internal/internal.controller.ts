import { Controller, Get, Headers, NotFoundException, Param, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/** Compara la clave interna sin filtrar información por tiempo de respuesta. */
function validKey(given: string | undefined): boolean {
  const expected = process.env.INTERNAL_API_KEY || '';
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Rutas entre backends del ecosistema (no para la app): protegidas con la
 * clave compartida INTERNAL_API_KEY (cabecera x-internal-key), no con JWT.
 */
@Controller('internal')
export class InternalController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Estado de una solicitud de domicilio y su contrato. Lo usa InOut para
   * avanzar solo el pedido que se entrega con Shotra (En reparto / Entregado).
   */
  @Public()
  @Get('requests/:id/delivery-status')
  async deliveryStatus(@Param('id') id: string, @Headers('x-internal-key') key?: string) {
    if (!validKey(key)) throw new UnauthorizedException();
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        contract: { select: { code: true, status: true, requesterSignedAt: true, providerSignedAt: true, completedAt: true } },
      },
    });
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    const c = request.contract;
    return {
      requestId: request.id,
      requestStatus: request.status,
      contract: c
        ? { code: c.code, status: c.status, signed: !!c.requesterSignedAt && !!c.providerSignedAt, completedAt: c.completedAt }
        : null,
    };
  }
}
