# SHOTRA — Backend

Marketplace de intermediación de servicios del ecosistema CycloNet.
NestJS + Prisma + PostgreSQL/PostGIS. Puerto `4100`.

- **Authoriza**: control de acceso (roles/planes) y facturación (fuente de verdad de facturas).
- **FactoNet**: portal de pagos de las facturas emitidas en Authoriza.

---

## Puesta en marcha (local, contra RDS staging)

1. Túnel SSH a la base de datos staging:

   ```
   ssh -i C:\Users\AlfredoMamby\cyclonet-ec2-key.pem -N ^
     -o ServerAliveInterval=30 -o ServerAliveCountMax=3 ^
     -L 5433:cyclonet-db.c29kws0qk0kv.us-east-1.rds.amazonaws.com:5432 ^
     ec2-user@3.95.90.144
   ```

   `.env` → `DATABASE_URL=postgresql://cyclonet_admin:<pass>@localhost:5433/shotra_staging`

2. Migrar + generar cliente + seed:

   ```
   npx prisma migrate dev
   npx prisma db seed
   ```

3. Arrancar en desarrollo:

   ```
   npm run dev
   ```

> Si `prisma generate` falla con `EPERM ... query_engine-windows.dll.node`, hay un
> backend corriendo que tiene bloqueado el engine. Deténlo y reintenta.

---

## Sistema de comisiones (monetización)

SHOTRA cobra una **comisión de intermediación al ofertante** por cada servicio
completado. El solicitante paga gratis (no depende de plan). El ofertante recibe
el valor convenido **menos** la comisión.

### Reglas de comisión (`CommissionRule`)

| Plan | Tasa | minFee | maxFee (tope por contrato) |
|------|------|--------|-----------------------------|
| FREE | 10%  | 0      | $50.000                     |
| PRO  | 5%   | 0      | $50.000                     |

- Base de cálculo: `agreedPrice` (precio de la propuesta aceptada).
- El plan del ofertante se deriva del rol de Authoriza: `adminShotra` = PRO, `userShotra` = FREE
  (se sincroniza en `UserProfile.plan` al consultar el perfil).
- Modelo escalable: hoy 1 regla por plan (rango 0..∞). Para tasas por rango de
  monto, agregar más filas `CommissionRule` con `minAmount`/`maxAmount`. El motor
  de cálculo no cambia.

### Devengo y facturación mensual acumulada

No se factura por servicio (una factura de $300 no es operativa). Las comisiones
se **acumulan** y se facturan una vez al mes por ofertante.

```
Contrato COMPLETED (ambas partes confirman)
   -> CommissionCharge { status: ACCRUED, periodKey: 'YYYY-MM' }
        │  (se acumula)
        ▼
Corte mensual (día 1 del próximo mes − 5 días, ~día 26)
   -> por ofertante: suma de cargos ACCRUED del periodo
        ├─ total >= $12.000  -> factura acumulada en Authoriza + charges INVOICED
        └─ total <  $12.000  -> se difiere al siguiente mes (sigue ACCRUED)
        ▼
Authoriza gestiona el ciclo de vida (payDay=1, vence +7, mora, suspensión).
Impago a payDay+20 -> Authoriza cancela el contrato y suspende al ofertante.
        ▼
Conciliación (polling cada 2h a GET /api/invoices/:id): Paid -> charges PAID
```

- **Umbral de facturación**: `$12.000` acumulados.
- **Contrato de comisiones**: se crea *lazy* en Authoriza (paquete `SHOTRA COMISIONES`,
  `isBillable: true`, `MONTHLY`, `payday: 1`) la primera vez que un ofertante
  supera el umbral. Se guarda su id en `UserProfile.authorizaCommissionContractId`.
- **Webhook**: aún no existe en FactoNet/Authoriza. Se usa polling; cuando el
  webhook exista, reemplaza a `reconcilePayments` sin tocar el resto.

### Estado de cuenta

`GET /commissions/statement` → `{ currentPeriodKey, accruedTotal, invoicedTotal,
paidTotal, billingThreshold, charges[] }`. El frontend lo muestra en
`app/account-statement.tsx` (accesible desde Perfil).

---

## Finalización en doble vía + declaración de pago

El dinero del servicio **no pasa por la app** (no hay custodia). Para dar
trazabilidad sin entrar en regulación financiera, el cierre requiere que **ambas
partes confirmen** y se registra una **declaración de pago**.

```
IN_PROGRESS / SIGNED
   │  ofertante: PATCH /contracts/:id/deliver
   ▼
PENDING_CONFIRMATION
   │  solicitante: PATCH /contracts/:id/confirm  (método de pago + comprobante/nota opcional)
   ▼
COMPLETED  -> aquí (y solo aquí) se devenga la comisión
```

- `PaymentDeclaration`: método (`CASH | TRANSFER | NEQUI | DAVIPLATA | PSE | OTHER`),
  monto (por defecto `agreedPrice`), comprobante opcional (URL) y nota.
- No es prueba de custodia; es **evidencia declarativa** para mediar disputas.

---

## Variables de entorno relevantes

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Postgres staging vía túnel (puerto 5433) |
| `AUTHORIZA_API_URL` | Base de Authoriza (ej. `http://localhost:3000`); las rutas cuelgan de `/api` |
| `AUTHORIZA_JWT_SECRET` | Misma clave que Authoriza para validar los JWT del ecosistema |
| `AUTHORIZA_SHOTRA_COMMISSION_PACKAGE_ID` | Id del paquete `SHOTRA COMISIONES` en Authoriza (para crear el contrato de comisiones) |

---

## Checklist de despliegue de comisiones

1. **Shotra**: túnel arriba → `npx prisma migrate dev` + `npx prisma db seed`
   (crea reglas de comisión FREE/PRO).
2. **Authoriza**: re-ejecutar el seed de paquetes SHOTRA para crear
   `SHOTRA COMISIONES`.
3. Copiar el id de ese paquete a `AUTHORIZA_SHOTRA_COMMISSION_PACKAGE_ID` en el
   `.env` de Shotra.
4. Reiniciar el backend de Shotra.

---

## Notas de arquitectura

- **Fase 1 (actual)**: comisión facturada vía Authoriza, pago del servicio por
  fuera con declaración. Sin pasarela ni custodia.
- **Fase 2 (futuro)**: escrow/split payments con un PSP licenciado
  (Wompi/Mercado Pago) y cuenta empresarial; el PSP custodia, no SHOTRA. El
  webhook de confirmación reemplazará el polling.
