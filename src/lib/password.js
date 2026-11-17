import { hash, compare } from 'bcryptjs';
import { env } from '../config/env.js';

export function hashPassword(plainPassword) {
  return hash(plainPassword, env.BCRYPT_ROUNDS);
}

export function verifyPassword(plainPassword, passwordHash) {
  return compare(plainPassword, passwordHash);
}
