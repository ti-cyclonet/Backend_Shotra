import { Injectable, Logger } from '@nestjs/common';

/**
 * Cliente HTTP hacia Authoriza (fuente de verdad de contratos y facturas del
 * ecosistema CycloNet). Usa fetch nativo de Node 20.
 *
 * Endpoints relevantes de Authoriza:
 *  - POST /api/contracts            crea un contrato
 *  - POST /api/invoices             crea una factura
 *  - GET  /api/invoices/:id         estado de factura
 */
@Injectable()
export class AuthorizaClient {
  private readonly logger = new Logger(AuthorizaClient.name);
  private readonly baseUrl: string;

  constructor() {
    // AUTHORIZA_API_URL suele ser http://localhost:3000 ; las rutas cuelgan de /api
    const raw = process.env.AUTHORIZA_API_URL || 'http://localhost:3000';
    this.baseUrl = raw.replace(/\/+$/, '');
  }

  private url(path: string) {
    return `${this.baseUrl}/api${path.startsWith('/') ? path : `/${path}`}`;
  }

  private async request<T = any>(method: string, path: string, body?: any): Promise<T> {
    const res = await fetch(this.url(path), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg = typeof data === 'object' ? JSON.stringify(data) : String(data);
      throw new Error(`Authoriza ${method} ${path} failed (${res.status}): ${msg}`);
    }
    return data as T;
  }

  /** Crea un contrato en Authoriza. Devuelve el contrato creado (incluye id). */
  async createContract(input: {
    userId: string;
    packageId: string;
    value: number;
    mode: 'MONTHLY' | 'SEMIANNUAL' | 'ANNUAL';
    payday?: number;
    startDate: string; // ISO date
    status?: string; // ej. 'ACTIVE'
  }): Promise<any> {
    return this.request('POST', '/contracts', input);
  }

  /** Crea una factura en Authoriza. */
  async createInvoice(input: {
    value: number;
    issueDate: string; // ISO date
    expirationDate: string; // ISO date
    userId: string;
    status?: string; // ej. 'Issued'
  }): Promise<any> {
    return this.request('POST', '/invoices', input);
  }

  /** Consulta una factura por id (para conciliar el estado de pago). */
  async getInvoice(invoiceId: string | number): Promise<any> {
    return this.request('GET', `/invoices/${invoiceId}`);
  }
}
