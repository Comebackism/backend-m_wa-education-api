/**
 * Operational error ที่รู้จัก — ส่ง statusCode + code ให้ client ได้ตรง ๆ
 * error ที่ไม่ใช่ ApiError จะถูกมองเป็น 500 และไม่ leak stack ใน production
 */
export class ApiError extends Error {
  constructor(statusCode, message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = options.code ?? defaultCode(statusCode);
    this.details = options.details;
  }

  static badRequest(message, details) {
    return new ApiError(400, message, { code: 'BAD_REQUEST', details });
  }

  static unauthorized(message = 'ต้องเข้าสู่ระบบก่อน') {
    return new ApiError(401, message, { code: 'UNAUTHORIZED' });
  }

  static forbidden(message = 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้') {
    return new ApiError(403, message, { code: 'FORBIDDEN' });
  }

  static notFound(message = 'ไม่พบข้อมูลที่ต้องการ') {
    return new ApiError(404, message, { code: 'NOT_FOUND' });
  }

  static conflict(message, details) {
    return new ApiError(409, message, { code: 'CONFLICT', details });
  }

  static unprocessable(message, details) {
    return new ApiError(422, message, { code: 'UNPROCESSABLE_ENTITY', details });
  }
}

function defaultCode(statusCode) {
  if (statusCode === 400) return 'BAD_REQUEST';
  if (statusCode === 401) return 'UNAUTHORIZED';
  if (statusCode === 403) return 'FORBIDDEN';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 409) return 'CONFLICT';
  if (statusCode === 422) return 'UNPROCESSABLE_ENTITY';
  return 'INTERNAL_ERROR';
}

/** ตัดฟิลด์ลับออกจาก user object ก่อนส่งกลับ */
export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}
