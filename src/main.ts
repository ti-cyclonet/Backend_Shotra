import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS
  if (process.env.DISABLE_CORS !== 'true') {
    app.enableCors({
      origin: [
        'http://localhost:8081', // Expo dev
        'http://localhost:19006', // Expo web
        'http://localhost:3000',
        'https://shotra.cyclonet.com.co',
      ],
      credentials: true,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  }

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger (solo en dev)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('SHOTRA API')
      .setDescription('Short Trades — Marketplace de servicios profesionales')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = process.env.PORT || 4100;
  await app.listen(port);
  console.log(`
    SHOTRA Backend
    ━━━━━━━━━━━━━━━━━━━━━━━━━
      Puerto:    ${port}
      Entorno:   ${process.env.NODE_ENV || 'development'}
      Docs:      http://localhost:${port}/docs
      Health:    http://localhost:${port}/api/health
    ━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
}

bootstrap();
