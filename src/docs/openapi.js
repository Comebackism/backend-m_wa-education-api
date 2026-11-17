/**
 * OpenAPI 3.0 specification สำหรับ WA Education API
 *
 * เขียนเป็น JS object (ไม่ใช่ YAML) เพื่อให้ตรวจ type/แก้ไขง่ายในตัว editor
 * แล้วถูกเสิร์ฟผ่าน Swagger UI ที่ `GET /api/docs`
 * และเสิร์ฟเป็น JSON ให้เครื่องมืออื่น (Postman / codegen) ที่ `GET /api/docs/openapi.json`
 */

const json = (schema) => ({ 'application/json': { schema } });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

/** คำตอบสำเร็จ: คืนค่าได้หลายรูปแบบ จึงให้ผู้เรียกกำหนด schema เอง */
const ok = (description, schema) => ({ 200: { description, content: json(schema) } });
const created = (description, schema) => ({ 201: { description, content: json(schema) } });
const noContent = (description) => ({ 204: { description } });

/** error มาตรฐานของทุก endpoint (รูปเดียวกันหมด: { error: { code, message, details? } }) */
const errors = {
  400: { description: 'คำขอไม่ถูกต้อง (validation ล้มเหลว)', content: json(ref('Error')) },
  401: { description: 'ไม่ได้เข้าสู่ระบบ / token ไม่ถูกต้องหรือหมดอายุ', content: json(ref('Error')) },
  403: { description: 'ไม่มีสิทธิ์ (บทบาทไม่ตรง หรือไม่ใช่เจ้าของข้อมูล)', content: json(ref('Error')) },
  404: { description: 'ไม่พบข้อมูลที่ระบุ', content: json(ref('Error')) },
  409: { description: 'ข้อมูลขัดแย้ง/ซ้ำกับที่มีอยู่', content: json(ref('Error')) },
  422: { description: 'ข้อมูลถูกต้องแต่ยังประมวลผลไม่ได้ (เช่น ตรวจไม่ครบ)', content: json(ref('Error')) },
  429: { description: 'เรียกบ่อยเกินกำหนด (rate limit)', content: json(ref('Error')) },
  500: { description: 'ข้อผิดพลาดภายในระบบ', content: json(ref('Error')) },
};

/** เลือกเฉพาะ error code ที่เป็นไปได้ของแต่ละ endpoint */
const pick = (...codes) => Object.fromEntries(codes.map((code) => [code, errors[code]]));

/** พารามิเตอร์ path แบบ {key} ที่เป็น uuid */
const pathParam = (name, description) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string', format: 'uuid' },
});

const body = (schema, description) => ({ required: true, description, content: json(schema) });

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'WA Education API',
    version: '0.1.0',
    description: [
      'REST API ของระบบสอบออนไลน์ (ครู + นักเรียน)',
      '',
      '**การยืนยันตัวตน** — เรียก `POST /api/auth/login` พร้อม `role` (`TEACHER` / `STUDENT`)',
      'แล้วแนบ `Authorization: Bearer <accessToken>` กับทุก endpoint ที่ไม่ใช่ auth',
      '',
      '**Anti-leak** — นักเรียนจะเห็นคะแนน/เฉลย/หมายเหตุของครู เฉพาะเมื่อครูปล่อยผล (`status = RELEASED`) เท่านั้น',
      '',
      'ลองใช้ได้ทันทีด้วยบัญชีตัวอย่าง: `teacher@demo.local` / `Teacher123!` (ดูบัญชีนักเรียนใน README)',
    ].join('\n'),
  },
  servers: [
    { url: 'http://localhost:4000', description: 'เครื่องพัฒนา (development)' },
  ],
  tags: [
    { name: 'Auth', description: 'สมัคร / เข้าสู่ระบบ / ต่ออายุ token' },
    { name: 'Courses', description: 'รายวิชา (ครู)' },
    { name: 'Classrooms', description: 'ห้องเรียน + การเข้าเรียน (ครู & นักเรียน)' },
    { name: 'Students', description: 'จัดการบัญชีนักเรียน (ครู)' },
    { name: 'Exams', description: 'สร้างข้อสอบ / คำถาม / เกณฑ์ตัดเกรด / มอบหมาย (ครู)' },
    { name: 'Grading', description: 'ตรวจอัตนัย + ปล่อยผลสอบ (ครู)' },
    { name: 'Student — My', description: 'ฝั่งนักเรียน: ข้อสอบที่ได้รับ / ทำข้อสอบ / ผลสอบ' },
    { name: 'System', description: 'health check + เอกสาร API' },
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    // =======================================================================
    // System
    // =======================================================================
    '/health': {
      get: {
        tags: ['System'],
        summary: 'ตรวจสอบสถานะเซิร์ฟเวอร์',
        security: [],
        responses: {
          ...ok('เซิร์ฟเวอร์ทำงานปกติ', {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'ok' },
              uptime: { type: 'number', example: 123.45 },
              timestamp: { type: 'string', format: 'date-time' },
            },
          }),
        },
      },
    },
    '/api': {
      get: {
        tags: ['System'],
        summary: 'รายการ endpoint ทั้งหมด',
        security: [],
        responses: { ...ok('แผนที่ endpoint', { type: 'object' }) },
      },
    },
    '/api/docs/openapi.json': {
      get: {
        tags: ['System'],
        summary: 'OpenAPI spec (JSON)',
        security: [],
        responses: { ...ok('OpenAPI 3.0 document', { type: 'object' }) },
      },
    },

    // =======================================================================
    // Auth
    // =======================================================================
    '/api/auth/teacher/register': {
      post: {
        tags: ['Auth'],
        summary: 'ครูสมัครสมาชิก',
        security: [],
        requestBody: body(ref('TeacherRegisterInput')),
        responses: {
          ...created('สมัครสำเร็จ คืนผู้ใช้ + token', ref('AuthResponse')),
          ...pick(400, 409, 429, 500),
        },
      },
    },
    '/api/auth/student/register': {
      post: {
        tags: ['Auth'],
        summary: 'นักเรียนสมัครสมาชิก',
        description: 'ถ้าแนบ `joinCode` จะเข้าห้องเรียนให้ทันที',
        security: [],
        requestBody: body(ref('StudentRegisterInput')),
        responses: {
          ...created('สมัครสำเร็จ คืนผู้ใช้ + token', ref('AuthResponse')),
          ...pick(400, 404, 409, 429, 500),
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'เข้าสู่ระบบ (ต้องระบุบทบาท)',
        description: 'ต้องส่ง `role` ให้ตรงกับบทบาทของบัญชี ถ้าไม่ตรงจะได้ `403`',
        security: [],
        requestBody: body(ref('LoginInput')),
        responses: {
          ...ok('เข้าสู่ระบบสำเร็จ', ref('AuthResponse')),
          ...pick(400, 401, 403, 429, 500),
        },
      },
    },
    '/api/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'ต่ออายุ token (rotate refresh token)',
        description: 'refresh token เก่าจะถูกเพิกถอนทันทีเมื่อต่ออายุสำเร็จ',
        security: [],
        requestBody: body(ref('RefreshInput')),
        responses: {
          ...ok('ต่ออายุสำเร็จ คืน token ชุดใหม่', ref('AuthResponse')),
          ...pick(400, 401, 500),
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'ออกจากระบบ (เพิกถอน refresh token)',
        security: [],
        requestBody: body(ref('RefreshInput')),
        responses: { ...noContent('เพิกถอนเรียบร้อย'), ...pick(400, 500) },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'ข้อมูลผู้ใช้ปัจจุบัน',
        responses: {
          ...ok('ข้อมูลผู้ใช้', { type: 'object', required: ['user'], properties: { user: ref('User') } }),
          ...pick(401, 500),
        },
      },
    },

    // =======================================================================
    // Courses (teacher)
    // =======================================================================
    '/api/courses': {
      get: {
        tags: ['Courses'],
        summary: 'รายวิชาทั้งหมดของครู',
        parameters: [
          { name: 'q', in: 'query', required: false, description: 'ค้นหาจากรหัสหรือชื่อวิชา', schema: { type: 'string' } },
        ],
        responses: {
          ...ok('รายการรายวิชา', { type: 'object', required: ['courses'], properties: { courses: { type: 'array', items: ref('Course') } } }),
          ...pick(401, 403, 500),
        },
      },
      post: {
        tags: ['Courses'],
        summary: 'สร้างรายวิชาใหม่',
        requestBody: body(ref('CourseInput')),
        responses: {
          ...created('สร้างสำเร็จ', { type: 'object', required: ['course'], properties: { course: ref('Course') } }),
          ...pick(400, 401, 403, 409, 500),
        },
      },
    },
    '/api/courses/{courseId}': {
      parameters: [pathParam('courseId', 'รหัสรายวิชา')],
      get: {
        tags: ['Courses'],
        summary: 'รายละเอียดรายวิชา (พร้อมห้องเรียน)',
        responses: {
          ...ok('รายละเอียดรายวิชา', { type: 'object', required: ['course'], properties: { course: ref('Course') } }),
          ...pick(401, 403, 404, 500),
        },
      },
      patch: {
        tags: ['Courses'],
        summary: 'แก้ไขรายวิชา',
        requestBody: body(ref('CourseInput')),
        responses: {
          ...ok('แก้ไขสำเร็จ', { type: 'object', required: ['course'], properties: { course: ref('Course') } }),
          ...pick(400, 401, 403, 404, 409, 500),
        },
      },
      delete: {
        tags: ['Courses'],
        summary: 'ลบรายวิชา',
        description: 'ลบไม่ได้ถ้ายังมีข้อสอบผูกอยู่ → `409`',
        responses: {
          ...ok('ลบสำเร็จ', { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } }),
          ...pick(401, 403, 404, 409, 500),
        },
      },
    },

    // =======================================================================
    // Classrooms
    // =======================================================================
    '/api/classrooms/join': {
      post: {
        tags: ['Classrooms'],
        summary: 'นักเรียนเข้าห้องเรียนด้วยรหัส (student)',
        requestBody: body({ type: 'object', required: ['joinCode'], properties: { joinCode: { type: 'string', minLength: 4, maxLength: 20, example: 'MATH41' } } }),
        responses: {
          ...created('เข้าห้องสำเร็จ', { type: 'object', required: ['classroom'], properties: { classroom: ref('Classroom') } }),
          ...pick(400, 401, 403, 404, 409, 500),
        },
      },
    },
    '/api/classrooms': {
      get: {
        tags: ['Classrooms'],
        summary: 'ห้องเรียนทั้งหมดของครู (teacher)',
        parameters: [
          { name: 'courseId', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          ...ok('รายการห้องเรียน', { type: 'object', required: ['classrooms'], properties: { classrooms: { type: 'array', items: ref('Classroom') } } }),
          ...pick(401, 403, 500),
        },
      },
      post: {
        tags: ['Classrooms'],
        summary: 'สร้างห้องเรียนใหม่ (teacher)',
        description: 'ระบบสร้าง `joinCode` ให้อัตโนมัติ',
        requestBody: body(ref('ClassroomInput')),
        responses: {
          ...created('สร้างสำเร็จ', { type: 'object', required: ['classroom'], properties: { classroom: ref('Classroom') } }),
          ...pick(400, 401, 403, 404, 500),
        },
      },
    },
    '/api/classrooms/{classroomId}': {
      parameters: [pathParam('classroomId', 'รหัสห้องเรียน')],
      get: {
        tags: ['Classrooms'],
        summary: 'รายละเอียดห้องเรียน + นักเรียน + ข้อสอบที่มอบหมาย (teacher)',
        responses: {
          ...ok('รายละเอียดห้องเรียน', { type: 'object', required: ['classroom'], properties: { classroom: ref('ClassroomDetail') } }),
          ...pick(401, 403, 404, 500),
        },
      },
      patch: {
        tags: ['Classrooms'],
        summary: 'แก้ไขชื่อห้องเรียน (teacher)',
        requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 200 } } }),
        responses: {
          ...ok('แก้ไขสำเร็จ', { type: 'object', required: ['classroom'], properties: { classroom: ref('Classroom') } }),
          ...pick(400, 401, 403, 404, 500),
        },
      },
      delete: {
        tags: ['Classrooms'],
        summary: 'ลบห้องเรียน (teacher)',
        description: 'ลบไม่ได้ถ้ามีข้อสอบที่มีการส่งคำตอบแล้ว → `409`',
        responses: {
          ...ok('ลบสำเร็จ', { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } }),
          ...pick(401, 403, 404, 409, 500),
        },
      },
    },
    '/api/classrooms/{classroomId}/students': {
      parameters: [pathParam('classroomId', 'รหัสห้องเรียน')],
      get: {
        tags: ['Classrooms'],
        summary: 'รายชื่อนักเรียนในห้อง (teacher)',
        responses: {
          ...ok('รายชื่อนักเรียน', { type: 'object', required: ['students'], properties: { students: { type: 'array', items: ref('StudentInClassroom') } } }),
          ...pick(401, 403, 404, 500),
        },
      },
      post: {
        tags: ['Classrooms'],
        summary: 'เพิ่มนักเรียนเข้าห้อง — ปุ่ม "+" (teacher)',
        description: 'ถ้ามีบัญชีอยู่แล้วให้ส่ง `studentId` / `email` / `studentCode` · ถ้ายังไม่มีให้ส่ง `email` + `fullName` เพื่อสร้างบัญชีใหม่ (คืน `temporaryPassword`)',
        requestBody: body(ref('AddStudentInput')),
        responses: {
          ...created('เพิ่มนักเรียนสำเร็จ', { type: 'object', properties: { student: ref('User'), temporaryPassword: { type: 'string', nullable: true, description: 'มีค่าเฉพาะเมื่อสร้างบัญชีใหม่' } } }),
          ...pick(400, 401, 403, 404, 409, 500),
        },
      },
    },
    '/api/classrooms/{classroomId}/students/{studentId}': {
      parameters: [pathParam('classroomId', 'รหัสห้องเรียน'), pathParam('studentId', 'รหัสนักเรียน')],
      delete: {
        tags: ['Classrooms'],
        summary: 'เอานักเรียนออกจากห้อง (teacher)',
        responses: {
          ...ok('เอาออกสำเร็จ', { type: 'object', properties: { classroomId: { type: 'string', format: 'uuid' }, studentId: { type: 'string', format: 'uuid' } } }),
          ...pick(401, 403, 404, 500),
        },
      },
    },

    // =======================================================================
    // Students (teacher)
    // =======================================================================
    '/api/students': {
      get: {
        tags: ['Students'],
        summary: 'รายชื่อนักเรียนทั้งหมดของครู (รวมทุกห้อง)',
        parameters: [
          { name: 'q', in: 'query', required: false, description: 'ค้นหาจากชื่อ / อีเมล / รหัสนักเรียน', schema: { type: 'string' } },
        ],
        responses: {
          ...ok('รายชื่อนักเรียน', { type: 'object', required: ['students'], properties: { students: { type: 'array', items: ref('TeacherStudent') } } }),
          ...pick(401, 403, 500),
        },
      },
      post: {
        tags: ['Students'],
        summary: 'เพิ่มนักเรียนใหม่ — ปุ่ม "+" (teacher)',
        description: 'ถ้าแนบ `classroomId` จะเข้าห้องนั้นให้ทันที',
        requestBody: body(ref('CreateStudentInput')),
        responses: {
          ...created('สร้างสำเร็จ', { type: 'object', properties: { student: ref('User'), temporaryPassword: { type: 'string', nullable: true } } }),
          ...pick(400, 401, 403, 404, 409, 500),
        },
      },
    },
    '/api/students/{studentId}': {
      parameters: [pathParam('studentId', 'รหัสนักเรียน')],
      patch: {
        tags: ['Students'],
        summary: 'แก้ไขข้อมูลนักเรียน (teacher)',
        requestBody: body(ref('UpdateStudentInput')),
        responses: {
          ...ok('แก้ไขสำเร็จ', { type: 'object', required: ['student'], properties: { student: ref('User') } }),
          ...pick(400, 401, 403, 404, 409, 500),
        },
      },
      delete: {
        tags: ['Students'],
        summary: 'ลบบัญชีนักเรียน (teacher)',
        description: 'คำตอบที่เคยส่งจะถูกลบตาม (cascade)',
        responses: {
          ...ok('ลบสำเร็จ', { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } }),
          ...pick(401, 403, 404, 500),
        },
      },
    },
    '/api/students/{studentId}/reset-password': {
      parameters: [pathParam('studentId', 'รหัสนักเรียน')],
      post: {
        tags: ['Students'],
        summary: 'รีเซ็ตรหัสผ่านนักเรียน (teacher)',
        description: 'ถ้าไม่ส่ง `password` ระบบจะสุ่มให้ แล้วคืนค่ากลับมา',
        requestBody: { required: false, content: json({ type: 'object', properties: { password: { type: 'string', minLength: 8, maxLength: 72 } } }) },
        responses: {
          ...ok('รีเซ็ตสำเร็จ', { type: 'object', required: ['password'], properties: { password: { type: 'string' } } }),
          ...pick(400, 401, 403, 404, 500),
        },
      },
    },

    // =======================================================================
    // Exams (teacher)
    // =======================================================================
    '/api/exams': {
      get: {
        tags: ['Exams'],
        summary: 'ข้อสอบทั้งหมดของครู',
        parameters: [
          { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'CLOSED'] } },
          { name: 'courseId', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          ...ok('รายการข้อสอบ', { type: 'object', required: ['exams'], properties: { exams: { type: 'array', items: ref('Exam') } } }),
          ...pick(400, 401, 403, 500),
        },
      },
      post: {
        tags: ['Exams'],
        summary: 'สร้างข้อสอบใหม่',
        requestBody: body(ref('ExamInput')),
        responses: {
          ...created('สร้างสำเร็จ', { type: 'object', required: ['exam'], properties: { exam: ref('Exam') } }),
          ...pick(400, 401, 403, 404, 500),
        },
      },
    },
    '/api/exams/default-cutoffs': {
      get: {
        tags: ['Exams'],
        summary: 'เกณฑ์ตัดเกรดมาตรฐาน A–F (ค่าเริ่มต้นของฟอร์ม)',
        responses: {
          ...ok('เกณฑ์มาตรฐาน', { type: 'object', required: ['cutoffs'], properties: { cutoffs: { type: 'array', items: ref('GradeCutoff') } } }),
          ...pick(401, 403, 500),
        },
      },
    },
    '/api/exams/{examId}': {
      parameters: [pathParam('examId', 'รหัสข้อสอบ')],
      get: {
        tags: ['Exams'],
        summary: 'รายละเอียดข้อสอบ (พร้อมข้อคำถาม + เฉลย + เกณฑ์ + การมอบหมาย)',
        responses: {
          ...ok('รายละเอียดข้อสอบ', { type: 'object', required: ['exam'], properties: { exam: ref('ExamDetail') } }),
          ...pick(401, 403, 404, 500),
        },
      },
      patch: {
        tags: ['Exams'],
        summary: 'แก้ไขข้อสอบ',
        requestBody: body(ref('ExamInput')),
        responses: {
          ...ok('แก้ไขสำเร็จ', { type: 'object', required: ['exam'], properties: { exam: ref('Exam') } }),
          ...pick(400, 401, 403, 404, 500),
        },
      },
      delete: {
        tags: ['Exams'],
        summary: 'ลบข้อสอบ',
        parameters: [
          { name: 'force', in: 'query', required: false, description: '`true` เพื่อลบแม้มีการส่งคำตอบแล้ว', schema: { type: 'string', enum: ['true', 'false'] } },
        ],
        responses: {
          ...ok('ลบสำเร็จ', { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } }),
          ...pick(401, 403, 404, 409, 500),
        },
      },
    },
    '/api/exams/{examId}/publish': {
      parameters: [pathParam('examId', 'รหัสข้อสอบ')],
      post: {
        tags: ['Exams'],
        summary: 'เปิดให้สอบ (PUBLISHED)',
        description: 'ต้องมีข้อคำถามอย่างน้อย 1 ข้อ และมอบหมายให้ห้องเรียนแล้วอย่างน้อย 1 ห้อง · ถ้ายังไม่ตั้งเกณฑ์ตัดเกรด ระบบใส่ A–F มาตรฐานให้',
        responses: {
          ...ok('เปิดสอบสำเร็จ', { type: 'object', required: ['exam'], properties: { exam: ref('Exam') } }),
          ...pick(400, 401, 403, 404, 500),
        },
      },
    },
    '/api/exams/{examId}/close': {
      parameters: [pathParam('examId', 'รหัสข้อสอบ')],
      post: {
        tags: ['Exams'],
        summary: 'ปิดการสอบ (CLOSED)',
        responses: {
          ...ok('ปิดสอบสำเร็จ', { type: 'object', required: ['exam'], properties: { exam: ref('Exam') } }),
          ...pick(401, 403, 404, 500),
        },
      },
    },
    '/api/exams/{examId}/questions': {
      parameters: [pathParam('examId', 'รหัสข้อสอบ')],
      post: {
        tags: ['Exams'],
        summary: 'เพิ่มข้อคำถาม',
        description: 'ข้อปรนัยต้องมีตัวเลือก ≥ 2 และมีเฉลย (`isCorrect = true`) 1 ตัวเลือกเท่านั้น · คะแนนเต็มของข้อสอบจะถูกคำนวณใหม่ให้อัตโนมัติ',
        requestBody: body(ref('QuestionInput')),
        responses: {
          ...created('เพิ่มสำเร็จ', { type: 'object', required: ['question'], properties: { question: ref('Question') } }),
          ...pick(400, 401, 403, 404, 500),
        },
      },
    },
    '/api/exams/{examId}/questions/order': {
      parameters: [pathParam('examId', 'รหัสข้อสอบ')],
      put: {
        tags: ['Exams'],
        summary: 'จัดลำดับข้อคำถามใหม่',
        requestBody: body({
          type: 'object',
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              minItems: 1,
              items: { type: 'object', required: ['id', 'order'], properties: { id: { type: 'string', format: 'uuid' }, order: { type: 'integer', minimum: 0 } } },
            },
          },
        }),
        responses: {
          ...ok('จัดลำดับสำเร็จ', { type: 'object', required: ['questions'], properties: { questions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, order: { type: 'integer' } } } } } }),
          ...pick(400, 401, 403, 404, 500),
        },
      },
    },
    '/api/exams/{examId}/questions/{questionId}': {
      parameters: [pathParam('examId', 'รหัสข้อสอบ'), pathParam('questionId', 'รหัสข้อคำถาม')],
      patch: {
        tags: ['Exams'],
        summary: 'แก้ไขข้อคำถาม',
        description: 'ถ้าส่ง `choices` มาใหม่ ตัวเลือกเดิมทั้งหมดจะถูกแทนที่',
        requestBody: body(ref('QuestionInput')),
        responses: {
          ...ok('แก้ไขสำเร็จ', { type: 'object', required: ['question'], properties: { question: ref('Question') } }),
          ...pick(400, 401, 403, 404, 500),
        },
      },
      delete: {
        tags: ['Exams'],
        summary: 'ลบข้อคำถาม',
        responses: {
          ...ok('ลบสำเร็จ', { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } }),
          ...pick(401, 403, 404, 500),
        },
      },
    },
    '/api/exams/{examId}/cutoffs': {
      parameters: [pathParam('examId', 'รหัสข้อสอบ')],
      get: {
        tags: ['Exams'],
        summary: 'ดูเกณฑ์ตัดเกรดของข้อสอบ',
        responses: {
          ...ok('เกณฑ์ตัดเกรด', { type: 'object', required: ['cutoffs'], properties: { cutoffs: { type: 'array', items: ref('GradeCutoff') } } }),
          ...pick(401, 403, 404, 500),
        },
      },
      put: {
        tags: ['Exams'],
        summary: 'กำหนดเกณฑ์ตัดเกรดใหม่ (แทนที่ทั้งหมด)',
        description: 'เกรดต้องไม่ซ้ำกัน · เมื่อเกณฑ์เปลี่ยน ระบบจะคิดเกรดของใบที่ตรวจแล้วใหม่ให้ทั้งหมด',
        requestBody: body(ref('CutoffsInput')),
        responses: {
          ...ok('บันทึกสำเร็จ', { type: 'object', required: ['cutoffs'], properties: { cutoffs: { type: 'array', items: ref('GradeCutoff') } } }),
          ...pick(400, 401, 403, 404, 500),
        },
      },
    },
    '/api/exams/{examId}/assignments': {
      parameters: [pathParam('examId', 'รหัสข้อสอบ')],
      post: {
        tags: ['Exams'],
        summary: 'มอบหมายข้อสอบให้ห้องเรียน',
        requestBody: body(ref('AssignmentInput')),
        responses: {
          ...created('มอบหมายสำเร็จ', { type: 'object', required: ['assignment'], properties: { assignment: ref('ExamAssignment') } }),
          ...pick(400, 401, 403, 404, 409, 500),
        },
      },
    },
    '/api/exams/{examId}/assignments/{assignmentId}': {
      parameters: [pathParam('examId', 'รหัสข้อสอบ'), pathParam('assignmentId', 'รหัสการมอบหมาย')],
      delete: {
        tags: ['Exams'],
        summary: 'ยกเลิกการมอบหมาย',
        responses: {
          ...ok('ยกเลิกสำเร็จ', { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } }),
          ...pick(401, 403, 404, 500),
        },
      },
    },

    // =======================================================================
    // Grading (teacher)
    // =======================================================================
    '/api/grading/exams/{examId}/submissions': {
      parameters: [pathParam('examId', 'รหัสข้อสอบ')],
      get: {
        tags: ['Grading'],
        summary: 'รายการส่งข้อสอบของทั้งชุด',
        parameters: [
          { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['IN_PROGRESS', 'SUBMITTED', 'GRADED', 'RELEASED'] } },
        ],
        responses: {
          ...ok('รายการการส่งข้อสอบ', { type: 'object', required: ['submissions'], properties: { submissions: { type: 'array', items: ref('SubmissionListItem') } } }),
          ...pick(400, 401, 403, 404, 500),
        },
      },
    },
    '/api/grading/exams/{examId}/release': {
      parameters: [pathParam('examId', 'รหัสข้อสอบ')],
      post: {
        tags: ['Grading'],
        summary: 'ปล่อยผลทั้งชุดข้อสอบ',
        description: 'ปล่อยเฉพาะใบที่ตรวจครบทุกข้อแล้ว · ใบที่ยังตรวจไม่ครบจะถูกข้าม',
        responses: {
          ...ok('ผลการปล่อย', {
            type: 'object',
            required: ['released', 'skipped'],
            properties: {
              released: { type: 'integer', description: 'จำนวนที่ปล่อยสำเร็จ' },
              skipped: { type: 'integer', description: 'จำนวนที่ข้ามเพราะยังตรวจไม่ครบ' },
              message: { type: 'string' },
            },
          }),
          ...pick(401, 403, 404, 500),
        },
      },
    },
    '/api/grading/submissions/{submissionId}': {
      parameters: [pathParam('submissionId', 'รหัสการส่งข้อสอบ')],
      get: {
        tags: ['Grading'],
        summary: 'รายละเอียดคำตอบทุกข้อ (สำหรับครูตรวจ)',
        responses: {
          ...ok('รายละเอียดการส่งข้อสอบ', { type: 'object', required: ['submission'], properties: { submission: ref('GradingSubmission') } }),
          ...pick(401, 403, 404, 500),
        },
      },
    },
    '/api/grading/answers/{answerId}': {
      parameters: [pathParam('answerId', 'รหัสคำตอบ')],
      patch: {
        tags: ['Grading'],
        summary: 'ตรวจอัตนัย 1 ข้อ (ถูก/ไม่ถูก + หมายเหตุ)',
        description: 'ใช้กับข้ออัตนัยเท่านั้น (ปรนัยตรวจอัตโนมัติแล้ว → `400`) · ให้คะแนนเกินคะแนนเต็มไม่ได้ → `400` · ตรวจครบจะเปลี่ยนสถานะเป็น `GRADED` และคิดเกรดทันที',
        requestBody: body(ref('GradeAnswerInput')),
        responses: {
          ...ok('ตรวจสำเร็จ คืนใบตอบที่อัปเดตแล้ว', { type: 'object', required: ['submission'], properties: { submission: ref('GradingSubmission') } }),
          ...pick(400, 401, 403, 404, 409, 500),
        },
      },
    },
    '/api/grading/submissions/{submissionId}/release': {
      parameters: [pathParam('submissionId', 'รหัสการส่งข้อสอบ')],
      post: {
        tags: ['Grading'],
        summary: 'ปุ่ม "ส่งผลไปให้นักเรียน" (รายคน)',
        description: 'ต้องตรวจครบทุกข้อก่อน ถ้ายังเหลือจะได้ `422`',
        responses: {
          ...ok('ปล่อยผลสำเร็จ', { type: 'object', required: ['submission'], properties: { submission: ref('Submission') } }),
          ...pick(401, 403, 404, 409, 422, 500),
        },
      },
    },

    // =======================================================================
    // Student — My
    // =======================================================================
    '/api/my/classrooms': {
      get: {
        tags: ['Student — My'],
        summary: 'ห้องเรียนที่นักเรียนคนนี้อยู่ (student)',
        responses: {
          ...ok('รายการห้องเรียน', { type: 'object', required: ['classrooms'], properties: { classrooms: { type: 'array', items: ref('Classroom') } } }),
          ...pick(401, 403, 500),
        },
      },
    },
    '/api/my/exams': {
      get: {
        tags: ['Student — My'],
        summary: 'ข้อสอบที่ได้รับมอบหมาย (student)',
        description: 'โชว์คะแนน/เกรดของตัวเองเฉพาะเมื่อ `mySubmission.status = RELEASED`',
        responses: {
          ...ok('รายการข้อสอบ', { type: 'object', required: ['exams'], properties: { exams: { type: 'array', items: ref('StudentExamListItem') } } }),
          ...pick(401, 403, 500),
        },
      },
    },
    '/api/my/exams/{examId}': {
      parameters: [pathParam('examId', 'รหัสข้อสอบ')],
      get: {
        tags: ['Student — My'],
        summary: 'รายละเอียดข้อสอบสำหรับนักเรียน (ไม่มีเฉลย)',
        description: 'ตัด `isCorrect` / `explanation` / `referenceText` / `points` ออกทั้งหมด พร้อมแนบคำตอบที่เคยบันทึกไว้',
        responses: {
          ...ok('กระดาษข้อสอบ', { type: 'object', required: ['exam'], properties: { exam: ref('StudentExam') } }),
          ...pick(401, 403, 404, 500),
        },
      },
    },
    '/api/my/exams/{examId}/submissions': {
      parameters: [pathParam('examId', 'รหัสข้อสอบ')],
      post: {
        tags: ['Student — My'],
        summary: 'เริ่มทำข้อสอบ (หรือทำใบเดิมต่อ)',
        description: 'ถ้าเคยเริ่มไว้และยังไม่ส่ง จะคืนใบเดิม · กำหนด `expiresAt` จาก `timeLimitMinutes` ของข้อสอบ',
        requestBody: { required: false, content: json({ type: 'object', properties: { displayMode: ref('DisplayMode') } }) },
        responses: {
          ...created('เริ่มทำสำเร็จ', { type: 'object', required: ['submission'], properties: { submission: ref('Submission') } }),
          ...pick(400, 401, 403, 404, 409, 500),
        },
      },
    },
    '/api/my/submissions/{submissionId}': {
      parameters: [pathParam('submissionId', 'รหัสการส่งข้อสอบ')],
      get: {
        tags: ['Student — My'],
        summary: 'สถานะการทำข้อสอบของตัวเอง (ไม่มีเฉลย)',
        responses: {
          ...ok('สถานะใบตอบ', { type: 'object', required: ['submission'], properties: { submission: ref('Submission') } }),
          ...pick(401, 403, 404, 500),
        },
      },
    },
    '/api/my/submissions/{submissionId}/answers': {
      parameters: [pathParam('submissionId', 'รหัสการส่งข้อสอบ')],
      put: {
        tags: ['Student — My'],
        summary: 'บันทึกคำตอบแบบ bulk',
        description: 'เรียกซ้ำได้เรื่อย ๆ ระหว่างทำ · ข้อปรนัยส่ง `choiceId` · ข้ออัตนัยส่ง `textAnswer`',
        requestBody: body({
          type: 'object',
          required: ['answers'],
          properties: {
            answers: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: {
                type: 'object',
                required: ['questionId'],
                properties: {
                  questionId: { type: 'string', format: 'uuid' },
                  choiceId: { type: 'string', format: 'uuid', nullable: true },
                  textAnswer: { type: 'string', maxLength: 20000, nullable: true },
                },
              },
            },
          },
        }),
        responses: {
          ...ok('บันทึกสำเร็จ', {
            type: 'object',
            required: ['savedCount'],
            properties: {
              savedCount: { type: 'integer' },
              answers: { type: 'array', items: { type: 'object', properties: { questionId: { type: 'string', format: 'uuid' }, choiceId: { type: 'string', nullable: true }, textAnswer: { type: 'string', nullable: true } } } },
            },
          }),
          ...pick(400, 401, 403, 404, 409, 500),
        },
      },
    },
    '/api/my/submissions/{submissionId}/submit': {
      parameters: [pathParam('submissionId', 'รหัสการส่งข้อสอบ')],
      post: {
        tags: ['Student — My'],
        summary: 'ส่งข้อสอบ',
        description: 'ปรนัยตรวจอัตโนมัติทันที · สถานะเป็น `SUBMITTED` ("ส่งแล้ว รอตรวจ") · ส่งซ้ำจะได้ `409`',
        requestBody: { required: false, content: json({ type: 'object', properties: { displayMode: ref('DisplayMode') } }) },
        responses: {
          ...ok('ส่งสำเร็จ', { type: 'object', required: ['submission'], properties: { submission: ref('Submission') } }),
          ...pick(400, 401, 403, 404, 409, 500),
        },
      },
    },
    '/api/my/results': {
      get: {
        tags: ['Student — My'],
        summary: 'รายการผลสอบของตัวเอง',
        description: 'ยังไม่ปล่อยผล → ไม่มีฟิลด์คะแนน/เกรด และ `pendingTeacherAction = true`',
        parameters: [
          { name: 'examId', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          ...ok('รายการผลสอบ', { type: 'object', required: ['results'], properties: { results: { type: 'array', items: ref('StudentResultListItem') } } }),
          ...pick(400, 401, 403, 500),
        },
      },
    },
    '/api/my/results/{submissionId}': {
      parameters: [pathParam('submissionId', 'รหัสการส่งข้อสอบ')],
      get: {
        tags: ['Student — My'],
        summary: 'ผลสอบ + เฉลย + หมายเหตุครู',
        description: '**ต้องเป็น `RELEASED` เท่านั้น** ไม่งั้นได้ `403` · เห็นเฉพาะผลของตัวเอง',
        responses: {
          ...ok('ผลสอบฉบับเต็ม', { type: 'object', required: ['result'], properties: { result: ref('StudentResult') } }),
          ...pick(401, 403, 404, 500),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'access token จาก `POST /api/auth/login`',
      },
    },
    schemas: {
      // --- enums & primitives --------------------------------------------
      Role: { type: 'string', enum: ['TEACHER', 'STUDENT'] },
      ExamStatus: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'CLOSED'] },
      QuestionType: { type: 'string', enum: ['MULTIPLE_CHOICE', 'SHORT_ANSWER', 'LONG_ANSWER'] },
      DisplayMode: { type: 'string', enum: ['SINGLE_PAGE', 'PAGINATED'] },
      SubmissionStatus: { type: 'string', enum: ['IN_PROGRESS', 'SUBMITTED', 'GRADED', 'RELEASED'] },

      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'NOT_FOUND' },
              message: { type: 'string', example: 'ไม่พบข้อสอบ' },
              details: { nullable: true, description: 'รายละเอียดเพิ่มเติม (ถ้ามี)' },
            },
          },
        },
      },

      // --- auth ----------------------------------------------------------
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          fullName: { type: 'string' },
          role: ref('Role'),
          studentCode: { type: 'string', nullable: true },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AuthResponse: {
        type: 'object',
        required: ['user', 'accessToken', 'refreshToken'],
        properties: {
          user: ref('User'),
          accessToken: { type: 'string', description: 'แนบเป็น `Authorization: Bearer ...`' },
          refreshToken: { type: 'string', description: 'ใช้ต่ออายุที่ `POST /api/auth/refresh`' },
          expiresAt: { type: 'string', format: 'date-time', description: 'เวลาหมดอายุของ refresh token' },
        },
      },
      TeacherRegisterInput: {
        type: 'object',
        required: ['email', 'password', 'fullName'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 255 },
          password: { type: 'string', minLength: 8, maxLength: 72 },
          fullName: { type: 'string', maxLength: 200 },
        },
      },
      StudentRegisterInput: {
        type: 'object',
        required: ['email', 'password', 'fullName'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 255 },
          password: { type: 'string', minLength: 8, maxLength: 72 },
          fullName: { type: 'string', maxLength: 200 },
          studentCode: { type: 'string', maxLength: 50, description: 'รหัสนักเรียน (ไม่บังคับ, ต้องไม่ซ้ำ)' },
          joinCode: { type: 'string', minLength: 4, maxLength: 20, description: 'รหัสห้องเรียนเพื่อเข้าห้องทันที' },
        },
      },
      LoginInput: {
        type: 'object',
        required: ['email', 'password', 'role'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
          role: ref('Role'),
        },
        example: { email: 'teacher@demo.local', password: 'Teacher123!', role: 'TEACHER' },
      },
      RefreshInput: {
        type: 'object',
        required: ['refreshToken'],
        properties: { refreshToken: { type: 'string' } },
      },

      // --- course / classroom --------------------------------------------
      Course: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          code: { type: 'string', example: 'MATH-M4' },
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          teacherId: { type: 'string', format: 'uuid' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          _count: {
            type: 'object',
            nullable: true,
            properties: { classrooms: { type: 'integer' }, exams: { type: 'integer' } },
          },
          classrooms: { type: 'array', items: ref('Classroom'), nullable: true, description: 'มีเฉพาะในรายละเอียดรายวิชา' },
        },
      },
      CourseInput: {
        type: 'object',
        required: ['code', 'title'],
        properties: {
          code: { type: 'string', maxLength: 50, example: 'MATH-M4' },
          title: { type: 'string', maxLength: 200 },
          description: { type: 'string', maxLength: 2000, nullable: true },
        },
      },
      Classroom: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'ม.4/1 ห้อง 2' },
          joinCode: { type: 'string', example: 'MATH41' },
          courseId: { type: 'string', format: 'uuid' },
          teacherId: { type: 'string', format: 'uuid' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          course: ref('CourseBrief'),
          _count: { type: 'object', nullable: true, properties: { enrollments: { type: 'integer' }, examAssignments: { type: 'integer' } } },
        },
      },
      ClassroomDetail: {
        allOf: [
          ref('Classroom'),
          {
            type: 'object',
            properties: {
              students: { type: 'array', items: ref('StudentInClassroom') },
              examAssignments: { type: 'array', items: ref('ExamAssignment') },
            },
          },
        ],
      },
      CourseBrief: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, code: { type: 'string' }, title: { type: 'string' }, description: { type: 'string', nullable: true } },
      },
      ClassroomInput: {
        type: 'object',
        required: ['name', 'courseId'],
        properties: { name: { type: 'string', maxLength: 200, example: 'ม.4/1 ห้อง 2' }, courseId: { type: 'string', format: 'uuid' } },
      },
      StudentInClassroom: {
        allOf: [ref('User'), { type: 'object', properties: { enrolledAt: { type: 'string', format: 'date-time' } } }],
      },
      TeacherStudent: {
        allOf: [
          ref('User'),
          {
            type: 'object',
            properties: {
              classrooms: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } } },
            },
          },
        ],
      },
      AddStudentInput: {
        type: 'object',
        description: 'ต้องระบุอย่างน้อย 1 อย่าง: `studentId`, `email` หรือ `studentCode` · ถ้ายังไม่มีบัญชี ต้องมี `email` + `fullName`',
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          studentCode: { type: 'string', maxLength: 50 },
          fullName: { type: 'string', maxLength: 200 },
          password: { type: 'string', minLength: 8, maxLength: 72, description: 'ไม่ส่ง = ใช้ studentCode หรือสุ่มให้' },
        },
      },
      CreateStudentInput: {
        type: 'object',
        required: ['email', 'fullName'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 255 },
          fullName: { type: 'string', maxLength: 200 },
          studentCode: { type: 'string', maxLength: 50 },
          password: { type: 'string', minLength: 8, maxLength: 72 },
          classroomId: { type: 'string', format: 'uuid', description: 'แนบเพื่อเข้าห้องทันที' },
        },
      },
      UpdateStudentInput: {
        type: 'object',
        properties: {
          fullName: { type: 'string', maxLength: 200 },
          email: { type: 'string', format: 'email', maxLength: 255 },
          studentCode: { type: 'string', maxLength: 50, nullable: true },
          isActive: { type: 'boolean' },
        },
      },

      // --- exam / question ------------------------------------------------
      Choice: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          questionId: { type: 'string', format: 'uuid' },
          label: { type: 'string', example: 'A' },
          text: { type: 'string' },
          isCorrect: { type: 'boolean', description: 'เฉลย — ไม่ส่งให้ฝั่งนักเรียนระหว่างสอบ' },
          order: { type: 'integer' },
        },
      },
      ChoiceInput: {
        type: 'object',
        required: ['label', 'text'],
        properties: {
          label: { type: 'string', maxLength: 10, example: 'A' },
          text: { type: 'string', maxLength: 2000 },
          isCorrect: { type: 'boolean', default: false },
          order: { type: 'integer', minimum: 0 },
        },
      },
      Question: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          examId: { type: 'string', format: 'uuid' },
          type: ref('QuestionType'),
          prompt: { type: 'string' },
          points: { type: 'number', example: 2 },
          order: { type: 'integer' },
          referenceText: { type: 'string', nullable: true, description: 'แนวคำตอบของครู (อัตนัย)' },
          explanation: { type: 'string', nullable: true, description: 'คำอธิบายเฉลย — แสดงหลังปล่อยผล' },
          choices: { type: 'array', items: ref('Choice') },
        },
      },
      QuestionInput: {
        type: 'object',
        required: ['type', 'prompt', 'points'],
        properties: {
          type: ref('QuestionType'),
          prompt: { type: 'string', maxLength: 20000 },
          points: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
          order: { type: 'integer', minimum: 0 },
          referenceText: { type: 'string', maxLength: 20000, nullable: true },
          explanation: { type: 'string', maxLength: 20000, nullable: true },
          choices: { type: 'array', maxItems: 10, items: ref('ChoiceInput'), description: 'บังคับเมื่อ type = MULTIPLE_CHOICE (≥ 2 ตัวเลือก, เฉลย 1 ตัว)' },
        },
      },
      GradeCutoff: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          examId: { type: 'string', format: 'uuid' },
          grade: { type: 'string', example: 'B' },
          minPercent: { type: 'number', description: 'ขอบล่างแบบรวม (inclusive) ของเปอร์เซ็นต์', example: 70 },
        },
      },
      CutoffsInput: {
        type: 'object',
        required: ['cutoffs'],
        properties: {
          cutoffs: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: { type: 'object', required: ['grade', 'minPercent'], properties: { grade: { type: 'string', maxLength: 5 }, minPercent: { type: 'number', minimum: 0, maximum: 100 } } },
          },
        },
        example: { cutoffs: [{ grade: 'A', minPercent: 80 }, { grade: 'B', minPercent: 70 }, { grade: 'F', minPercent: 0 }] },
      },
      Exam: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          status: ref('ExamStatus'),
          courseId: { type: 'string', format: 'uuid', nullable: true },
          teacherId: { type: 'string', format: 'uuid' },
          timeLimitMinutes: { type: 'integer', nullable: true, description: 'null = ไม่จำกัดเวลา' },
          defaultDisplayMode: ref('DisplayMode'),
          questionsPerPage: { type: 'integer' },
          totalsPoints: { type: 'number', description: 'คะแนนเต็มรวม (คำนวณอัตโนมัติ)' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          course: ref('CourseBrief'),
          questions: { type: 'array', items: ref('Question'), nullable: true },
          cutoffs: { type: 'array', items: ref('GradeCutoff'), nullable: true },
          _count: { type: 'object', nullable: true, properties: { questions: { type: 'integer' }, submissions: { type: 'integer' }, assignments: { type: 'integer' } } },
        },
      },
      ExamDetail: {
        allOf: [
          ref('Exam'),
          {
            type: 'object',
            properties: {
              assignments: { type: 'array', items: ref('ExamAssignment') },
              submissionStats: { type: 'array', items: { type: 'object', properties: { status: ref('SubmissionStatus'), count: { type: 'integer' } } } },
            },
          },
        ],
      },
      ExamInput: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', maxLength: 200 },
          description: { type: 'string', maxLength: 5000, nullable: true },
          courseId: { type: 'string', format: 'uuid', nullable: true },
          timeLimitMinutes: { type: 'integer', minimum: 1, maximum: 1440, nullable: true },
          defaultDisplayMode: ref('DisplayMode'),
          questionsPerPage: { type: 'integer', minimum: 1, maximum: 100 },
        },
        example: { title: 'สอบเก็บคะแนน บทที่ 1', timeLimitMinutes: 60, defaultDisplayMode: 'PAGINATED', questionsPerPage: 5 },
      },
      ExamAssignment: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          examId: { type: 'string', format: 'uuid' },
          classroomId: { type: 'string', format: 'uuid' },
          availableFrom: { type: 'string', format: 'date-time', nullable: true },
          availableTo: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          classroom: { type: 'object', nullable: true, properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, joinCode: { type: 'string' } } },
        },
      },
      AssignmentInput: {
        type: 'object',
        required: ['classroomId'],
        properties: {
          classroomId: { type: 'string', format: 'uuid' },
          availableFrom: { type: 'string', format: 'date-time', nullable: true },
          availableTo: { type: 'string', format: 'date-time', nullable: true },
        },
      },

      // --- submissions & grading ------------------------------------------
      Submission: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          examId: { type: 'string', format: 'uuid' },
          studentId: { type: 'string', format: 'uuid' },
          status: ref('SubmissionStatus'),
          displayMode: ref('DisplayMode'),
          startedAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
          submittedAt: { type: 'string', format: 'date-time', nullable: true },
          gradedAt: { type: 'string', format: 'date-time', nullable: true },
          releasedAt: { type: 'string', format: 'date-time', nullable: true },
          autoScore: { type: 'number', description: 'คะแนนปรนัย (ตรวจอัตโนมัติ)' },
          manualScore: { type: 'number', description: 'คะแนนอัตนัย (ครูตรวจ)' },
          totalScore: { type: 'number' },
          percent: { type: 'number', example: 70 },
          grade: { type: 'string', nullable: true, example: 'B' },
          answers: { type: 'array', nullable: true, items: ref('Answer'), description: 'มีเฉพาะบาง endpoint' },
        },
      },
      SubmissionListItem: {
        allOf: [
          ref('Submission'),
          {
            type: 'object',
            properties: {
              needsGrading: { type: 'boolean' },
              student: ref('User'),
            },
          },
        ],
      },
      Answer: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          submissionId: { type: 'string', format: 'uuid' },
          questionId: { type: 'string', format: 'uuid' },
          choiceId: { type: 'string', format: 'uuid', nullable: true },
          textAnswer: { type: 'string', nullable: true },
          isCorrect: { type: 'boolean', nullable: true, description: 'null = ยังไม่ตรวจ' },
          autoGraded: { type: 'boolean' },
          awardedPoints: { type: 'number', nullable: true },
          graderComment: { type: 'string', nullable: true, description: 'หมายเหตุของครู: ผิด/ถูกเพราะอะไร' },
          gradedById: { type: 'string', format: 'uuid', nullable: true },
          gradedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      GradingSubmission: {
        allOf: [
          ref('Submission'),
          {
            type: 'object',
            properties: {
              student: ref('User'),
              exam: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, totalsPoints: { type: 'number' } } },
              ungradedCount: { type: 'integer', description: 'จำนวนข้อที่ยังไม่ได้ตรวจ' },
              answers: { type: 'array', items: ref('GradingAnswer') },
            },
          },
        ],
      },
      GradingAnswer: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          questionId: { type: 'string', format: 'uuid' },
          type: ref('QuestionType'),
          prompt: { type: 'string' },
          points: { type: 'number' },
          referenceText: { type: 'string', nullable: true },
          explanation: { type: 'string', nullable: true },
          choices: { type: 'array', items: ref('Choice') },
          choiceId: { type: 'string', format: 'uuid', nullable: true },
          textAnswer: { type: 'string', nullable: true },
          correctChoiceId: { type: 'string', format: 'uuid', nullable: true },
          isCorrect: { type: 'boolean', nullable: true },
          autoGraded: { type: 'boolean' },
          awardedPoints: { type: 'number', nullable: true },
          graderComment: { type: 'string', nullable: true },
        },
      },
      GradeAnswerInput: {
        type: 'object',
        required: ['isCorrect'],
        properties: {
          isCorrect: { type: 'boolean', description: 'true = ถูก, false = ไม่ถูก' },
          awardedPoints: { type: 'number', minimum: 0, description: 'ไม่ส่ง = เต็มเมื่อถูก / 0 เมื่อผิด' },
          graderComment: { type: 'string', maxLength: 2000, nullable: true, description: 'อธิบายว่าผิดหรือถูกเพราะอะไร' },
        },
        example: { isCorrect: false, awardedPoints: 1, graderComment: 'ขั้นตอนถูกแต่คำนวณตอนท้ายคลาดเคลื่อน' },
      },

      // --- student side ---------------------------------------------------
      StudentExamListItem: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          status: ref('ExamStatus'),
          timeLimitMinutes: { type: 'integer', nullable: true },
          defaultDisplayMode: ref('DisplayMode'),
          questionsCount: { type: 'integer' },
          course: ref('CourseBrief'),
          canStart: { type: 'boolean', description: 'true = ยังไม่ส่ง (เริ่มทำ/ทำต่อได้)' },
          mySubmission: {
            type: 'object',
            nullable: true,
            properties: {
              id: { type: 'string', format: 'uuid' },
              status: ref('SubmissionStatus'),
              startedAt: { type: 'string', format: 'date-time' },
              expiresAt: { type: 'string', format: 'date-time', nullable: true },
              submittedAt: { type: 'string', format: 'date-time', nullable: true },
              totalScore: { type: 'number', description: 'มีเฉพาะเมื่อ RELEASED' },
              percent: { type: 'number', description: 'มีเฉพาะเมื่อ RELEASED' },
              grade: { type: 'string', nullable: true, description: 'มีเฉพาะเมื่อ RELEASED' },
            },
          },
        },
      },
      StudentExam: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          status: ref('ExamStatus'),
          timeLimitMinutes: { type: 'integer', nullable: true },
          defaultDisplayMode: ref('DisplayMode'),
          questionsPerPage: { type: 'integer' },
          totalsPoints: { type: 'number' },
          serverTime: { type: 'string', format: 'date-time', description: 'ใช้คำนวณเวลาที่เหลือ' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                type: ref('QuestionType'),
                prompt: { type: 'string' },
                order: { type: 'integer' },
                choices: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, label: { type: 'string' }, text: { type: 'string' }, order: { type: 'integer' } } } },
                myAnswer: { nullable: true, type: 'object', properties: { questionId: { type: 'string', format: 'uuid' }, choiceId: { type: 'string', nullable: true }, textAnswer: { type: 'string', nullable: true } } },
              },
            },
          },
          mySubmission: { ...ref('Submission'), nullable: true },
        },
      },
      StudentResultListItem: {
        type: 'object',
        properties: {
          submissionId: { type: 'string', format: 'uuid' },
          exam: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, totalsPoints: { type: 'number' }, course: ref('CourseBrief') } },
          status: ref('SubmissionStatus'),
          submittedAt: { type: 'string', format: 'date-time', nullable: true },
          pendingTeacherAction: { type: 'boolean', description: 'true = ครูยังไม่ปล่อยผล' },
          totalPoints: { type: 'number', description: 'มีเฉพาะเมื่อ RELEASED' },
          autoScore: { type: 'number', description: 'มีเฉพาะเมื่อ RELEASED' },
          manualScore: { type: 'number', description: 'มีเฉพาะเมื่อ RELEASED' },
          totalScore: { type: 'number', description: 'มีเฉพาะเมื่อ RELEASED' },
          percent: { type: 'number', description: 'มีเฉพาะเมื่อ RELEASED' },
          grade: { type: 'string', nullable: true, description: 'มีเฉพาะเมื่อ RELEASED' },
          releasedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      StudentResult: {
        type: 'object',
        properties: {
          submissionId: { type: 'string', format: 'uuid' },
          exam: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              title: { type: 'string' },
              totalsPoints: { type: 'number' },
              cutoffs: { type: 'array', items: ref('GradeCutoff') },
            },
          },
          status: ref('SubmissionStatus'),
          submittedAt: { type: 'string', format: 'date-time', nullable: true },
          releasedAt: { type: 'string', format: 'date-time', nullable: true },
          summary: {
            type: 'object',
            properties: {
              autoScore: { type: 'number' },
              manualScore: { type: 'number' },
              totalScore: { type: 'number' },
              percent: { type: 'number' },
              grade: { type: 'string', nullable: true },
            },
          },
          questions: { type: 'array', items: ref('StudentResultQuestion') },
        },
      },
      StudentResultQuestion: {
        type: 'object',
        properties: {
          questionId: { type: 'string', format: 'uuid' },
          type: ref('QuestionType'),
          prompt: { type: 'string' },
          points: { type: 'number' },
          explanation: { type: 'string', nullable: true },
          referenceText: { type: 'string', nullable: true },
          choices: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, label: { type: 'string' }, text: { type: 'string' }, isCorrect: { type: 'boolean' } } } },
          myAnswer: { type: 'object', properties: { choiceId: { type: 'string', nullable: true }, textAnswer: { type: 'string', nullable: true } } },
          result: {
            type: 'object',
            properties: {
              isCorrect: { type: 'boolean', nullable: true },
              awardedPoints: { type: 'number', nullable: true },
              autoGraded: { type: 'boolean' },
              teacherComment: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  },
};

export default openApiDocument;
