import { extname } from 'node:path';
import multer from 'multer';
import { ApiError } from '../lib/errors.js';

/**
 * อัปโหลดไฟล์สำหรับนำเข้าข้อมูล (CSV / Excel)
 * - เก็บใน memory (ไม่เขียนลงดิสก์) เพราะอ่านแล้วทิ้งทันที
 * - จำกัดขนาด 5 MB และ 1 ไฟล์ต่อคำขอ
 * - ตรวจนามสกุลก่อน แล้วให้ชั้นถัดไปตรวจเนื้อหาอีกครั้ง
 */

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMPORT_EXTENSIONS = ['.csv', '.xlsx'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1 },
  fileFilter(req, file, callback) {
    const ext = extname(file.originalname ?? '').toLowerCase();
    if (!ALLOWED_IMPORT_EXTENSIONS.includes(ext)) {
      callback(
        ApiError.badRequest(
          `รองรับเฉพาะไฟล์ ${ALLOWED_IMPORT_EXTENSIONS.join(', ')} (ได้รับ "${ext || file.originalname}")`,
        ),
      );
      return;
    }
    callback(null, true);
  },
});

/** ห่อ multer เพื่อแปลง MulterError เป็น ApiError (รูปแบบ error เดียวกับทั้งระบบ) */
export function uploadSingleFile(field = 'file') {
  const handler = upload.single(field);

  return (req, res, next) => {
    handler(req, res, (error) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          next(ApiError.badRequest(`ไฟล์ใหญ่เกิน ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB`));
          return;
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
          next(ApiError.badRequest(`ไม่รู้จักฟิลด์ไฟล์ "${error.field}" — ใช้ฟิลด์ชื่อ "${field}"`));
          return;
        }
        next(ApiError.badRequest(`อัปโหลดไฟล์ไม่สำเร็จ: ${error.message}`));
        return;
      }
      next(error);
    });
  };
}
