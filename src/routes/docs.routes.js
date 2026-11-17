import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from '../docs/openapi.js';

/**
 * เอกสาร API แบบอินเทอร์แอกทีฟ
 *   GET /api/docs               → Swagger UI
 *   GET /api/docs/openapi.json  → OpenAPI 3.0 (ใช้ import เข้า Postman / codegen ได้)
 *
 * เปิด/ปิดได้ด้วย env `DOCS_ENABLED` (ค่าเริ่มต้น: เปิดใน dev, ปิดใน production)
 */
const router = Router();

const swaggerUiOptions = {
  customSiteTitle: 'WA Education API — Docs',
  swaggerOptions: {
    persistAuthorization: true, // คง token ไว้หลัง refresh หน้า
    displayRequestDuration: true,
    docExpansion: 'none',
    tryItOutEnabled: true,
  },
};

router.get('/docs/openapi.json', (req, res) => {
  res.json(openApiDocument);
});

router.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, swaggerUiOptions));

export default router;
