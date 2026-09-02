# Debian slim (glibc + OpenSSL 3) evita el problema de libssl.so.1.1 de Alpine con Prisma
FROM node:20-slim AS builder
WORKDIR /app

# OpenSSL requerido por Prisma para generar/ejecutar el engine correcto
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npx nest build

FROM node:20-slim
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
ENV NODE_ENV=production
EXPOSE 4100
CMD ["node", "dist/main"]
