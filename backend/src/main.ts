import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: 'http://localhost:3300',
    methods: ['GET', 'POST', 'DELETE'],
  });

  const port = process.env.PORT ?? 3310;
  await app.listen(port);
  console.log(`Workflow API running on http://localhost:${port}`);
}

bootstrap();
