-- Aviso al solicitante cuando su publicación vence (ver src/requests/request-expiry.ts)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REQUEST_EXPIRED';
