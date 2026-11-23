import { Injectable, Logger } from '@nestjs/common';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface OsrmRoute {
  distanceM: number;
  durationS: number;
  /** GeoJSON LineString ([lng, lat]) */
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

/**
 * Cliente mínimo de OSRM (motor de rutas por calles).
 *
 * OSRM_URL apunta por defecto al servidor público de demostración, el mismo
 * que ya usa la app para dibujar la ruta de un domicilio. Tiene límites de uso
 * y no garantiza disponibilidad: sirve para poco volumen. Para escalar, montar
 * un osrm-backend propio con el extracto de Colombia y cambiar OSRM_URL.
 */
@Injectable()
export class OsrmClient {
  private readonly logger = new Logger(OsrmClient.name);

  private get baseUrl(): string {
    return (process.env.OSRM_URL || 'https://router.project-osrm.org').replace(/\/+$/, '');
  }

  /**
   * Ruta en carro que pasa por los puntos en orden. Devuelve null si OSRM no
   * responde a tiempo o no encuentra ruta (quien llama decide qué hacer).
   */
  async route(points: LatLng[], opts: { geometry?: boolean; timeoutMs?: number } = {}): Promise<OsrmRoute | null> {
    if (points.length < 2) return null;
    const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const overview = opts.geometry ? 'full' : 'false';
    const url = `${this.baseUrl}/route/v1/driving/${coords}?overview=${overview}&geometries=geojson&steps=false`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 3000) });
      if (!res.ok) {
        this.logger.warn(`OSRM respondió ${res.status}`);
        return null;
      }
      const data: any = await res.json();
      const r = data?.code === 'Ok' ? data.routes?.[0] : null;
      if (!r) return null;
      return {
        distanceM: Math.round(r.distance),
        durationS: Math.round(r.duration),
        geometry: r.geometry ?? { type: 'LineString', coordinates: [] },
      };
    } catch (err) {
      this.logger.warn(`OSRM no disponible: ${(err as Error).message}`);
      return null;
    }
  }
}
