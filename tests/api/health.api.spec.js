import { expect, test } from './fixtures.js';

/**
 * ตรวจ "สัญญาพื้นฐาน" ของเซิร์ฟเวอร์จากภายนอก
 * (health check + รายการปลายทาง + รูปแบบ error มาตรฐาน)
 */

test.describe('ระบบพื้นฐาน', () => {
  test('GET /health ตอบ 200 พร้อมสถานะ ok', async ({ request }) => {
    const response = await request.get('/health');

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  test('GET /api บอกรายการปลายทางของ API', async ({ request }) => {
    const response = await request.get('/api');

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      name: 'wa-education-api',
      endpoints: { auth: '/api/auth', courses: '/api/courses' },
    });
  });

  test('เส้นทางที่ไม่มีจริง → 404 รูปแบบ { error: { code } }', async ({ request }) => {
    const response = await request.get('/api/definitely-not-here');

    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  test('JSON ที่ไม่ถูกต้องใน body → 400', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      data: '{ not json',
    });

    expect(response.status()).toBe(400);
  });
});
