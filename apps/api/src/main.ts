import 'reflect-metadata';
import { createApiApplication } from './application';

async function bootstrap(): Promise<void> {
  const app = await createApiApplication();
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on http://localhost:${port}/api/v1/health`);
}

void bootstrap();
