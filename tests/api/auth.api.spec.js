import { expect, test } from './fixtures.js';

/** เส้นทางยืนยันตัวตน — สมัคร, เข้าสู่ระบบ, ต่ออายุ token, ออกจากระบบ */

const PASSWORD = 'Password123!';

test.describe('การยืนยันตัวตน', () => {
  test('สมัครครู → เข้าสู่ระบบ → ดูข้อมูลตัวเอง', async ({ request }) => {
    const email = 'teacher.auth@test.local';

    const register = await request.post('/api/auth/teacher/register', {
      data: { email, password: PASSWORD, fullName: 'ครูสมชาย ใจดี' },
    });
    expect(register.status()).toBe(201);
    const registered = await register.json();
    expect(registered.user).toMatchObject({ email, role: 'TEACHER' });
    expect(registered.user).not.toHaveProperty('passwordHash');
    expect(typeof registered.accessToken).toBe('string');
    expect(typeof registered.refreshToken).toBe('string');

    const login = await request.post('/api/auth/login', {
      data: { email, password: PASSWORD, role: 'TEACHER' },
    });
    expect(login.status()).toBe(200);
    const { accessToken } = await login.json();

    const me = await request.get('/api/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(me.status()).toBe(200);
    expect((await me.json()).user.email).toBe(email);
  });

  test('รหัสผ่านผิด → 401 และไม่เปิดเผยข้อมูลผู้ใช้', async ({ request }) => {
    const email = 'wrong-pass@test.local';
    await request.post('/api/auth/teacher/register', {
      data: { email, password: PASSWORD, fullName: 'ครูเอ' },
    });

    const response = await request.post('/api/auth/login', {
      data: { email, password: 'not-the-password', role: 'TEACHER' },
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.user).toBeUndefined();
  });

  test('เข้าเส้นทางที่ต้องล็อกอินโดยไม่มี token → 401', async ({ request }) => {
    const response = await request.get('/api/auth/me');

    expect(response.status()).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHORIZED');
  });

  test('สมัครซ้ำอีเมลเดิม → 409', async ({ request }) => {
    const data = { email: 'duplicate@test.local', password: PASSWORD, fullName: 'ครูซ้ำ' };

    expect((await request.post('/api/auth/teacher/register', { data })).status()).toBe(201);

    const again = await request.post('/api/auth/teacher/register', { data });
    expect(again.status()).toBe(409);
    expect((await again.json()).error.code).toBe('CONFLICT');
  });

  test('refresh token ใช้ได้ครั้งเดียว (rotate)', async ({ request }) => {
    const register = await request.post('/api/auth/teacher/register', {
      data: { email: 'rotate@test.local', password: PASSWORD, fullName: 'ครูอาร์' },
    });
    const { refreshToken } = await register.json();

    const first = await request.post('/api/auth/refresh', { data: { refreshToken } });
    expect(first.status()).toBe(200);
    const rotated = await first.json();
    expect(rotated.refreshToken).not.toBe(refreshToken);

    // token เดิมถูกเพิกถอนไปแล้ว
    const reuse = await request.post('/api/auth/refresh', { data: { refreshToken } });
    expect(reuse.status()).toBe(401);
  });

  test('ออกจากระบบแล้ว refresh token ใช้ต่อไม่ได้', async ({ request }) => {
    const register = await request.post('/api/auth/teacher/register', {
      data: { email: 'logout@test.local', password: PASSWORD, fullName: 'ครูออก' },
    });
    const { refreshToken } = await register.json();

    expect((await request.post('/api/auth/logout', { data: { refreshToken } })).status()).toBe(204);

    const afterLogout = await request.post('/api/auth/refresh', { data: { refreshToken } });
    expect(afterLogout.status()).toBe(401);
  });

  test('ล็อกอินผิดรูปแบบ (อีเมลไม่ถูกต้อง) → 400', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: { email: 'not-an-email', password: 'x' },
    });

    expect(response.status()).toBe(400);
    expect((await response.json()).error.details).toBeDefined();
  });

  test('ล็อกอินผิดช่องทางบทบาท → 403', async ({ request }) => {
    const email = 'role@test.local';
    await request.post('/api/auth/teacher/register', {
      data: { email, password: PASSWORD, fullName: 'ครูโรล' },
    });

    const response = await request.post('/api/auth/login', {
      data: { email, password: PASSWORD, role: 'STUDENT' },
    });

    expect(response.status()).toBe(403);
  });
});
