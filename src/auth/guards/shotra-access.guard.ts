import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// Roles válidos que Authoriza emite para la aplicación Shotra
const VALID_SHOTRA_ROLES = ['adminShotra', 'userShotra'];

/**
 * Verifica que el JWT del usuario contenga un rol válido de Shotra.
 *
 * El flujo real de acceso es:
 * 1. El frontend de Shotra hace login en Authoriza con applicationName='Shotra'.
 * 2. Authoriza verifica que el usuario tenga un UserRole activo con un rol de Shotra.
 * 3. Si no lo tiene → Authoriza devuelve 401 "UNAUTHORIZED" (el usuario nunca obtiene token).
 * 4. Si sí lo tiene → Authoriza emite un JWT con el rol en el payload.
 * 5. Shotra recibe el JWT, y este guard valida que el rol sea de Shotra.
 *
 * Si un usuario tiene token de otra app (ej. InOut) e intenta usarlo aquí,
 * este guard lo bloquea (el rol no es de Shotra).
 */
@Injectable()
export class ShotraAccessGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Saltar endpoints públicos
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.userId) return false;

    // El token DEBE traer un rol de Shotra. Authoriza ya emite el rol en el JWT
    // (login normal o con selección de contrato). Si el rol no es de Shotra
    // (o falta), se rechaza: un token de otra app no habilita el acceso aquí.
    if (!user.rol || !VALID_SHOTRA_ROLES.includes(user.rol)) {
      throw new ForbiddenException(
        'No tienes acceso a Shotra con este token. Inicia sesion en Shotra desde la aplicacion.',
      );
    }

    return true;
  }
}
