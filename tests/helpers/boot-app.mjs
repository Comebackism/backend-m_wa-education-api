import { createServer } from 'node:http';
import { createApp } from '../../src/app.js';

/**
 * บูตแอปจริงแบบเบา ๆ สำหรับเทสต์ที่ต้องตรวจพฤติกรรมตาม environment
 * (เช่น เปิด Swagger docs, เปิด morgan logger เมื่อไม่ใช่โหมดเทสต์)
 *
 * - ฟังบนพอร์ตว่าง (0) แล้วพิมพ์บรรทัด `PORT=<เลข>` ออก stdout
 * - รอ SIGTERM/SIGINT แล้วปิดตัวเอง (ใช้คู่กับเทสต์ที่ spawn โปรเซสนี้)
 */

const app = createApp();
const server = createServer(app);

server.listen(0, () => {
  const { port } = server.address();
  console.log(`PORT=${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
