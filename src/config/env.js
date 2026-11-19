import 'dotenv/config';
import { z } from 'zod';

/**
 * อ่านและตรวจค่า environment variables ครั้งเดียวตอนบูต
 * ถ้าค่าไหนผิด/ขาด แอปจะไม่ start เพื่อไม่ให้พังตอน runtime
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /// เปิด Swagger UI — ไม่ใส่ = เปิดใน dev/test, ปิดใน production
  DOCS_ENABLED: z.enum(['true', 'false']).optional(),
  /// เพดาน rate limit ตอน dev/test (production ตรึงค่าจริงไว้ใน middleware/rateLimit.js)
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  /// "true" = ปิด rate limit ทั้งหมด (มีผลเฉพาะเมื่อไม่ใช่ production)
  RATE_LIMIT_DISABLED: z.enum(['true', 'false']).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');
  console.error(`\n[env] invalid environment configuration:\n${details}\n`);
  process.exit(1);
}

export const env = parsed.data;

/** comma separated origins → array, สำหรับ config ของ cors */
export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const isProduction = env.NODE_ENV === 'production';

/** เปิดเอกสาร Swagger UI หรือไม่ (ค่าเริ่มต้น: เปิดทุกโหมดยกเว้น production) */
export const docsEnabled = env.DOCS_ENABLED ? env.DOCS_ENABLED === 'true' : !isProduction;
