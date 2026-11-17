import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[api] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

async function shutdown(signal) {
  console.log(`[api] ${signal} received — shutting down`);
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
  // ถ้าไม่ปิดภายใน 10 วินาที ให้บังคับปิด
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
