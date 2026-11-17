import { ApiError } from '../lib/errors.js';

const SOURCES = ['params', 'body'];

/**
 * ตรวจข้อมูลด้วย zod แล้วเขียนค่าที่ผ่านการ coerce กลับลง req
 * - req.params / req.body → เขียนทับได้ตามปกติ
 * - req.query → Express 5 ประกาศเป็น getter (เขียนทับไม่ได้) จึงเก็บที่ req.validatedQuery
 */
export function validate(schemas) {
  return (req, res, next) => {
    const issues = [];
    const validated = {};

    for (const source of SOURCES) {
      const schema = schemas[source];
      if (!schema) continue;
      const result = schema.safeParse(req[source] ?? {});
      if (result.success) {
        req[source] = result.data;
      } else {
        issues.push(...result.error.issues.map((issue) => ({
          field: [source, ...issue.path].join('.'),
          message: issue.message,
        })));
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query ?? {});
      if (result.success) {
        validated.query = result.data;
      } else {
        issues.push(...result.error.issues.map((issue) => ({
          field: ['query', ...issue.path].join('.'),
          message: issue.message,
        })));
      }
    }

    if (issues.length > 0) {
      throw ApiError.badRequest('ข้อมูลที่ส่งมาไม่ถูกต้อง', issues);
    }

    req.validatedQuery = validated.query ?? {};
    next();
  };
}

/** ตัวช่วยอ่าน query ที่ผ่าน validation แล้ว */
export function query(req) {
  return req.validatedQuery ?? {};
}
