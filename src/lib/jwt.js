import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ISSUER = 'wa-education-api';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, type: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN, issuer: ISSUER },
  );
}

export function signRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, type: 'refresh', jti: crypto.randomUUID() },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN, issuer: ISSUER },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: ISSUER });
}

/** เก็บ refresh token ใน DB แบบ hash เท่านั้น (ถ้า DB รั่ว ก็ยังปลอม token ไม่ได้) */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
