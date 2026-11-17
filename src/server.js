import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { closeRealtime, initRealtime } from './realtime/index.js';

const app = createApp();

// REST API และ Socket.IO ใช้พอร์ตเดียวกัน (แยก path กันคนละส่วน)
const server = createServer(app);
initRealtime(server);

server.listen(env.PORT, () => {
  console.log(`[api] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  console.log(`[realtime] connect at ws://localhost:${env.PORT}/socket.io`);
});

async function shutdown(signal) {
  console.log(`[api] ${signal} received — shutting down`);
  await closeRealtime().catch(() => {});
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
  // ถ้าไม่ปิดภายใน 10 วินาที ให้บังคับปิด
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
