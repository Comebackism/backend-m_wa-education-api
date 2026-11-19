import { createApp } from '../../src/app.js';

/**
 * เปิด Express app บนพอร์ตว่าง (0) สำหรับเทสต์ระดับ HTTP
 * ใช้ fetch ของ Node แทน supertest — ไม่ต้องเพิ่ม dependency
 */
export async function startTestServer() {
  const app = createApp();
  const server = app.listen(0);

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    app,
    server,
    baseUrl,
    client: createClient(baseUrl),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function createClient(baseUrl) {
  async function request(method, path, { token, body, headers = {} } = {}) {
    const finalHeaders = { Accept: 'application/json', ...headers };
    if (token) finalHeaders.Authorization = `Bearer ${token}`;

    let payload;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      finalHeaders['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: finalHeaders,
      body: payload,
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    return { status: response.status, data, text, headers: response.headers };
  }

  return {
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, body, options = {}) => request('POST', path, { ...options, body }),
    patch: (path, body, options = {}) => request('PATCH', path, { ...options, body }),
    put: (path, body, options = {}) => request('PUT', path, { ...options, body }),
    del: (path, options) => request('DELETE', path, options),
  };
}

/** ล็อกอินแล้วคืน access token (ใช้ในเทสต์ HTTP) */
export async function loginToken(client, email, password, role) {
  const response = await client.post('/api/auth/login', { email, password, role });
  return response;
}
