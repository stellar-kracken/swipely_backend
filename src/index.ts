import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor';
import { setupOpenAPI } from './config/openapi.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Use Pino logger
  app.useLogger(app.get(Logger));

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  // Global correlation ID interceptor
  app.useGlobalInterceptors(new CorrelationIdInterceptor());

  // CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api');

  // Setup OpenAPI docs (only in development)
  if (process.env.NODE_ENV !== 'production') {
    setupOpenAPI(app);
    console.log('📚 Swagger documentation available at /api/docs');
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  const logger = app.get(Logger);
  logger.info(`🚀 Application running on port ${port}`);
  
  if (process.env.NODE_ENV !== 'production') {
    logger.info(`📚 API Docs: http://localhost:${port}/api/docs`);
    logger.info(`📄 OpenAPI Spec: http://localhost:${port}/api/docs-json`);
  }
}
bootstrap();
