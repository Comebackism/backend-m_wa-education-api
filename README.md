# 🎓 WA Education API — ระบบสอบออนไลน์ (Backend)

REST API สำหรับระบบจัดการเรียนการสอนและการสอบออนไลน์ รองรับ **2 บทบาท** คือ **ครู (Teacher)** และ **นักเรียน (Student)**

สร้างด้วย **Node.js + Express 5 + Prisma 7 + PostgreSQL** (JavaScript / ESM)
ส่วน Frontend (Vue) แยกโปรเจกต์ต่างหาก

---

## 📑 สารบัญ

- [สถาปัตยกรรมและเทคโนโลยี](#-สถาปัตยกรรมและเทคโนโลยี)
- [โครงสร้างข้อมูล (Course → Classroom → Exam)](#-โครงสร้างข้อมูล)
- [สิทธิ์การใช้งาน (RBAC)](#-สิทธิ์การใช้งาน-rbac)
- [กติกาทางธุรกิจที่สำคัญ](#-กติกาทางธุรกิจที่สำคัญ)
- [เริ่มต้นใช้งาน (Getting Started)](#-เริ่มต้นใช้งาน-getting-started)
- [บัญชีทดลอง (Demo Data)](#-บัญชีทดลอง-demo-data)
- [เอกสาร API (Swagger UI)](#-เอกสาร-api-swagger-ui)
- [Realtime (Socket.IO)](#-realtime-socketio)
- [ภาพรวม API](#-ภาพรวม-api)
- [โครงสร้างโปรเจกต์](#-โครงสร้างโปรเจกต์)
- [เอกสารออกแบบ (Diagrams)](#-เอกสารออกแบบ-diagrams)

---

## 🧱 สถาปัตยกรรมและเทคโนโลยี

| ส่วน | เทคโนโลยี |
| :--- | :--- |
| Runtime | Node.js ≥ 20.19 (ESM, `"type": "module"`) |
| Web framework | Express 5 |
| ORM | Prisma 7 (`@prisma/client` + `@prisma/adapter-pg`) |
| Database | PostgreSQL |
| Validation | Zod 4 |
| Auth | JWT (access + refresh token rotation), bcryptjs |
| Security | helmet, CORS allow-list, express-rate-limit |
| Realtime | Socket.IO 4 (แจ้งเตือนการเปลี่ยนแปลงแบบทันที) |
| เอกสาร API | Swagger UI (`swagger-ui-express`) + OpenAPI 3.0 |
| Logging | morgan |

---

## 🗂 โครงสร้างข้อมูล

```
Course (รายวิชา)
  └── Classroom (ห้องเรียน)  ← มี joinCode ให้นักเรียนเข้าห้องเองได้
        └── Enrollment (การเข้าเรียนของนักเรียน)
              └── Exam Assignment (มอบหมายข้อสอบให้ห้องเรียน + ช่วงเวลาเปิด/ปิด)
                    └── Exam (ข้อสอบ)
                          ├── Question (คำถาม: MULTIPLE_CHOICE / SHORT_ANSWER / LONG_ANSWER, มีคะแนนต่อข้อ)
                          │     └── Choice (ตัวเลือกของข้อปรนัย + เฉลย isCorrect)
                          ├── GradeCutoff (เกณฑ์ตัดเกรด A–F ตามเปอร์เซ็นต์)
                          └── Submission (การส่งข้อสอบของนักเรียน 1 คน = 1 ครั้ง)
                                └── Answer (คำตอบรายข้อ + คะแนนที่ได้ + หมายเหตุของครู)
```

- ข้อสอบ 1 ชุดถูก **มอบหมาย (assign)** ให้ห้องเรียนได้หลายห้อง แต่ละห้องมีช่วงเวลาเปิด–ปิดของตัวเอง
- นักเรียน 1 คนทำข้อสอบ 1 ชุดได้ **1 ครั้ง** (unique ที่ `examId + studentId`)
- แต่ละข้อกำหนด **คะแนน (points)** ได้เอง

ดู ER Diagram ฉบับเต็มได้ที่ [`diagrams/ER_DIAGRAM.md`](diagrams/ER_DIAGRAM.md)

---

## 🔐 สิทธิ์การใช้งาน (RBAC)

ระบบแยกช่องทางเข้าใช้งานตามบทบาท และบังคับที่ Middleware (`authenticate` + `teacherOnly` / `studentOnly`)

| บทบาท | สิทธิ์หลัก |
| :--- | :--- |
| **TEACHER** | จัดการรายวิชา, ห้องเรียน, นักเรียน (เพิ่ม/แก้ไข/ลบ + ปุ่ม "+"), สร้างและแก้ไขข้อสอบ, กำหนดเกณฑ์ตัดเกรด, มอบหมายข้อสอบ, ตรวจอัตนัย, ปล่อยผลสอบ |
| **STUDENT** | เข้าห้องเรียนด้วยรหัส, ดูข้อสอบที่ได้รับมอบหมาย, ทำข้อสอบ, ดูผลสอบ **หลังครูกดปล่อยผลแล้วเท่านั้น** |

การยืนยันตัวตน:

- `POST /api/auth/login` ต้องส่ง `role` (`TEACHER` / `STUDENT`) มาด้วยเสมอ — ล็อกอินผิดช่องทางจะได้ `403`
- ใช้ **access token (อายุสั้น)** แนบ `Authorization: Bearer <token>`
- **refresh token** ถูก rotate ทุกครั้งที่ต่ออายุ และเก็บแบบ **hashed (sha256)** ในฐานข้อมูล
- ครูสามารถเข้าถึงได้เฉพาะข้อมูลของตัวเอง (ownership check ทุก endpoint)

---

## 📏 กติกาทางธุรกิจที่สำคัญ

**1. การทำข้อสอบ**

- นักเรียนเลือกโหมดแสดงผลได้: `SINGLE_PAGE` (หน้าเดียว) หรือ `PAGINATED` (แบ่งหน้า)
- มี **time limit** ได้ (`timeLimitMinutes`) — เมื่อเริ่มทำจะคำนวณ `expiresAt` ให้อัตโนมัติ
- กดส่งแล้วสถานะเป็น `SUBMITTED` = **"ส่งแล้ว รอตรวจ"**
- คำตอบถูกบันทึกแบบ bulk ได้เรื่อย ๆ ระหว่างทำ (`PUT .../answers`) และตรวจสอบว่า `choiceId` ใช้กับข้อปรนัยเท่านั้น

**2. การตรวจและตัดเกรด**

- **ปรนัย (MULTIPLE_CHOICE)** ตรวจอัตโนมัติทันทีที่นักเรียนกดส่ง โดยเทียบกับเฉลย → `autoScore`
- **อัตนัย (SHORT_ANSWER / LONG_ANSWER)** ครูตรวจเอง: ระบุ **ถูก / ไม่ถูก** พร้อม **หมายเหตุ** (ผิดเพราะอะไร / ถูกเพราะอะไร) ปรับคะแนนได้ (`awardedPoints`) → `manualScore`
- เมื่อตรวจครบทุกข้อ สถานะเปลี่ยนเป็น `GRADED`, คำนวณ `totalScore`, `percent` และเทียบ **เกณฑ์ตัดเกรด (A–F)** ให้อัตโนมัติ
- ครูตรวจเกินคะแนนเต็ม หรือตรวจข้อปรนัยด้วยมือ → `400`

**3. การไม่ให้ผลสอบรั่ว (Release Gate)**

- นักเรียนดูคะแนน / เฉลย / หมายเหตุของครู **ไม่ได้** จนกว่าครูจะกด **"ส่งผลไปให้นักเรียน"**
- บังคับที่ระดับ Service: ถ้า `status !== 'RELEASED'` จะตอบ `403`
- แม้ปล่อยผลแล้ว นักเรียนคนอื่นก็ยังเข้าดูผลของเพื่อนไม่ได้
- ครูปล่อยผลได้แบบ **รายคน** หรือ **ทั้งชุดข้อสอบ** (ข้ามคนที่ยังตรวจไม่ครบ)

**4. ความปลอดภัยของ payload ฝั่งนักเรียน**

- ตอนดูกระดาษข้อสอบ จะตัดฟิลด์ `isCorrect`, `explanation`, `referenceText` และ `points` ออกจาก response ทั้งหมด
- นักเรียนเห็นเฉลยและคำอธิบาย **เฉพาะในหน้าผลสอบที่ถูกปล่อยแล้ว**

---

## 🚀 เริ่มต้นใช้งาน (Getting Started)

### 1. ติดตั้ง dependencies

```bash
npm install
```

### 2. เตรียมไฟล์ environment

```bash
cp .env.example .env
```

จากนั้นแก้ค่าใน `.env` (ดูรายละเอียดทั้งหมดใน `.env.example`):

```env
NODE_ENV=development
PORT=4000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/wa_education?schema=public"
JWT_ACCESS_SECRET="change-me-access-secret"
JWT_REFRESH_SECRET="change-me-refresh-secret"
CORS_ORIGIN=http://localhost:5173
DOCS_ENABLED=   # เว้นว่าง = เปิด Swagger ใน dev / ปิดใน production
```

> สร้าง secret จริงด้วย `openssl rand -base64 48`
> แอปจะ **validate env ด้วย zod ตอนบูต** ถ้าค่าไหนผิดจะแจ้งและไม่สตาร์ต

### 3. เตรียมฐานข้อมูล PostgreSQL

เลือกวิธีใดวิธีหนึ่ง:

**ใช้ Docker (แนะนำ)**

```bash
docker compose up -d
# ฐานข้อมูลจะอยู่ที่ host port 5433 → ปรับ DATABASE_URL ให้เป็น ...localhost:5433...
```

**ใช้ PostgreSQL ที่ติดตั้งในเครื่อง** — สร้าง database ชื่อ `wa_education`

### 4. สร้างตารางและข้อมูลตัวอย่าง

```bash
npm run migrate:deploy   # apply migration ทั้งหมด
npm run seed             # สร้างข้อมูลตัวอย่าง (ครู + นักเรียน + ข้อสอบ)
```

> Prisma 7 **ไม่ auto-generate client** และ **ไม่ auto-seed** ให้หลัง migrate
> ถ้าต้องการ client ใหม่ให้รัน `npm run generate`

### 5. รันเซิร์ฟเวอร์

```bash
npm run dev    # โหมดพัฒนา (--watch)
npm start      # โหมดปกติ
```

ตรวจสอบว่าเซิร์ฟเวอร์ทำงาน: `GET http://localhost:4000/health`

---

## 👥 บัญชีทดลอง (Demo Data)

สร้างโดย `npm run seed`

| บทบาท | อีเมล | รหัสผ่าน |
| :--- | :--- | :--- |
| ครู | `teacher@demo.local` | `Teacher123!` |
| นักเรียน | `student1@demo.local` | `Student123!` |
| นักเรียน | `student2@demo.local` | `Student123!` |
| นักเรียน | `student3@demo.local` | `Student123!` |

รหัสเข้าห้องเรียน (joinCode): **`MATH41`**

ข้อมูลตัวอย่างมาพร้อมข้อสอบ 5 ข้อ (ปรนัย 3 + อัตนัย 2, คะแนนเต็ม 10) และเกณฑ์ตัดเกรด A–F

---

## 📘 เอกสาร API (Swagger UI)

โปรเจกต์มีเอกสาร API แบบอินเทอร์แอกทีฟให้แล้ว (OpenAPI 3.0) — ไม่ต้องเขียน Swagger annotation ในโค้ด แต่เก็บ spec ไว้ที่ [`src/docs/openapi.js`](src/docs/openapi.js)

| ปลายทาง | รายละเอียด |
| :--- | :--- |
| `GET /api/docs` | **Swagger UI** — ดูทุก endpoint และกด **Try it out** ยิง API จริงได้เลย |
| `GET /api/docs/openapi.json` | OpenAPI spec (JSON) — ใช้ import เข้า Postman / Insomnia / codegen |

วิธีใช้:

1. รันเซิร์ฟเวอร์ (`npm run dev`) แล้วเปิด <http://localhost:4000/api/docs>
2. กด **Authorize** 🔓 แล้ววาง `accessToken` ที่ได้จาก `POST /api/auth/login`
   (หรือกด Try it out ที่ `/api/auth/login` ด้วยบัญชีตัวอย่างก่อน)
3. token จะถูกจำไว้ในเบราว์เซอร์ (`persistAuthorization`) จึงยิง endpoint อื่นต่อได้ทันที

รหัสข้อผิดพลาดทั้งหมด (`400/401/403/404/409/422/429/500`) ใช้รูปแบบเดียวกันหมด:

```json
{ "error": { "code": "FORBIDDEN", "message": "ผลสอบยังไม่ถูกปล่อย กรุณารอครูประกาศผล" } }
```

**เปิด/ปิดเอกสาร** ด้วย env `DOCS_ENABLED`

- ไม่ตั้งค่า → เปิดใน `development` / `test`, **ปิดอัตโนมัติใน `production`**
- `DOCS_ENABLED=false` → ปิดทุกโหมด
- `DOCS_ENABLED=true` → เปิดแม้ใน production (ระวัง: เผยโครงสร้าง API ให้สาธารณะ)

> เมื่อเพิ่ม endpoint ใหม่ อย่าลืมอัปเดต `src/docs/openapi.js` ด้วยจะได้ตรงกับของจริง

---

## 🔌 Realtime (Socket.IO)

นอกจาก REST API ระบบมีชั้น realtime ให้ frontend ใช้แจ้งเตือนการเปลี่ยนแปลงแบบทันที
(แนบอยู่บนพอร์ตเดียวกัน แยกกันที่ path `/socket.io`) — ยืนยันตัวตนด้วย **access token ตัวเดียวกับ REST**

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', { auth: { token: accessToken } });
socket.on('connected', (me) => console.log('realtime ready', me));
```

| Event (server → client) | เกิดเมื่อ | ผู้รับ |
| :--- | :--- | :--- |
| `connected` | เชื่อมต่อสำเร็จ | ผู้ที่เชื่อมต่อ |
| `exam:published` | ครูเปิดสอบ | นักเรียนในห้องที่ถูกมอบหมาย |
| `submission:submitted` | นักเรียนส่งข้อสอบ | ครูเจ้าของข้อสอบ |
| `submission:graded` | ครูตรวจอัตนัยเสร็จ 1 ข้อ | ครูเจ้าของข้อสอบ |
| `result:released` | ครูกด "ส่งผลไปให้นักเรียน" | นักเรียนเจ้าของผลสอบ |

ออกแบบให้ event เป็นแค่ **"สะกิด"** — เมื่อได้รับแล้วให้ไปดึงข้อมูลใหม่ผ่าน REST (ไม่ส่ง state ทั้งก้อนผ่าน socket)

> 📖 รายละเอียดทั้งหมด (ตัวอย่าง Vue, วิธี join ห้อง, `ping/pong`, การสเกลหลาย instance) อยู่ที่
> [`docs/REALTIME.md`](docs/REALTIME.md)
>
> ทดสอบได้ด้วย `npm run test:realtime` (ต้องรันเซิร์ฟเวอร์ค้างไว้ในอีกเทอร์มินัล)

---

## 🌐 ภาพรวม API

Base path: `/api` — ทุก endpoint (ยกเว้น auth และ `/health`) ต้องแนบ Bearer token
รันเซิร์ฟเวอร์แล้วเปิด **<http://localhost:4000/api/docs>** เพื่อดูฉบับอินเทอร์แอกทีฟ

### Auth — `/api/auth`

| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| POST | `/teacher/register` | ครูสมัครสมาชิก |
| POST | `/student/register` | นักเรียนสมัครสมาชิก (แนบ `joinCode` เพื่อเข้าห้องทันที) |
| POST | `/login` | เข้าสู่ระบบ (ต้องส่ง `role`) |
| POST | `/refresh` | ต่ออายุ token (rotate refresh token) |
| POST | `/logout` | ออกจากระบบ (เพิกถอน refresh token) |
| GET | `/me` | ข้อมูลผู้ใช้ปัจจุบัน |

### ครู (Teacher)

| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| GET/POST | `/api/courses` | รายวิชา: ดูทั้งหมด / สร้างใหม่ |
| GET/PATCH/DELETE | `/api/courses/:courseId` | รายละเอียด / แก้ไข / ลบ |
| GET/POST | `/api/classrooms` | ห้องเรียน: ดูทั้งหมด / สร้างใหม่ |
| GET/PATCH/DELETE | `/api/classrooms/:classroomId` | รายละเอียด / แก้ไข / ลบ |
| GET | `/api/classrooms/:classroomId/students` | รายชื่อนักเรียนในห้อง |
| POST | `/api/classrooms/:classroomId/students` | เพิ่มนักเรียนเข้าห้อง (ปุ่ม "+") |
| DELETE | `/api/classrooms/:classroomId/students/:studentId` | เอานักเรียนออกจากห้อง |
| GET | `/api/students` | รายชื่อนักเรียนทั้งหมดของครู |
| POST | `/api/students` | เพิ่มนักเรียนใหม่ (คืนรหัสผ่านชั่วคราว) |
| PATCH/DELETE | `/api/students/:studentId` | แก้ไข / ลบนักเรียน |
| POST | `/api/students/:studentId/reset-password` | รีเซ็ตรหัสผ่านนักเรียน |
| GET/POST | `/api/exams` | ข้อสอบ: ดูทั้งหมด / สร้างใหม่ |
| GET/PATCH/DELETE | `/api/exams/:examId` | รายละเอียด / แก้ไข / ลบ |
| POST | `/api/exams/:examId/publish` \| `/close` | เปิด / ปิดการสอบ |
| GET | `/api/exams/default-cutoffs` | เกณฑ์ตัดเกรดมาตรฐาน (ค่าเริ่มต้นของฟอร์ม) |
| POST | `/api/exams/:examId/questions` | เพิ่มข้อคำถาม (ปรนัย/อัตนัย + คะแนน) |
| PATCH/DELETE | `/api/exams/:examId/questions/:questionId` | แก้ไข / ลบข้อคำถาม |
| PUT | `/api/exams/:examId/questions/order` | จัดลำดับข้อคำถาม |
| GET/PUT | `/api/exams/:examId/cutoffs` | ดู / กำหนดเกณฑ์ตัดเกรด A–F |
| POST | `/api/exams/:examId/assignments` | มอบหมายข้อสอบให้ห้องเรียน (+ ช่วงเวลา) |
| DELETE | `/api/exams/:examId/assignments/:assignmentId` | ยกเลิกการมอบหมาย |
| GET | `/api/grading/exams/:examId/submissions` | รายการส่งข้อสอบของทั้งชุด |
| GET | `/api/grading/submissions/:submissionId` | รายละเอียดคำตอบทุกข้อ (สำหรับตรวจ) |
| PATCH | `/api/grading/answers/:answerId` | ตรวจอัตนัย: ถูก/ไม่ถูก + หมายเหตุ + ปรับคะแนน |
| POST | `/api/grading/submissions/:submissionId/release` | **"ส่งผลไปให้นักเรียน"** (รายคน) |
| POST | `/api/grading/exams/:examId/release` | ปล่อยผลทั้งชุด (ข้ามคนที่ยังตรวจไม่ครบ) |

### นักเรียน (Student) — `/api/my`

| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| POST | `/api/classrooms/join` | เข้าห้องเรียนด้วย `joinCode` |
| GET | `/api/my/classrooms` | ห้องเรียนที่ตัวเองอยู่ |
| GET | `/api/my/exams` | ข้อสอบที่ได้รับมอบหมาย + `canStart` |
| GET | `/api/my/exams/:examId` | รายละเอียดข้อสอบ (ไม่มีเฉลย) |
| POST | `/api/my/exams/:examId/submissions` | เริ่มทำข้อสอบ (หรือทำใบเดิมต่อ) |
| GET | `/api/my/submissions/:submissionId` | สถานะการทำข้อสอบของตัวเอง |
| PUT | `/api/my/submissions/:submissionId/answers` | บันทึกคำตอบแบบ bulk |
| POST | `/api/my/submissions/:submissionId/submit` | ส่งข้อสอบ → `SUBMITTED` (รอตรวจ) |
| GET | `/api/my/results` | รายการผลสอบ (ซ่อนคะแนนจนกว่าจะปล่อย) |
| GET | `/api/my/results/:submissionId` | ผลสอบ + เฉลย + หมายเหตุครู (ต้อง `RELEASED`) |

### สถานะของ Submission

`IN_PROGRESS` → `SUBMITTED` (ส่งแล้ว รอตรวจ) → `GRADED` (ตรวจครบ) → `RELEASED` (ปล่อยผลให้นักเรียนแล้ว)

---

## 🧩 โครงสร้างโปรเจกต์

```
src/
  app.js                 # ประกอบ Express app (helmet, cors, routes, error handler)
  server.js              # entrypoint + graceful shutdown
  config/env.js          # โหลดและ validate env ด้วย zod
  docs/openapi.js        # OpenAPI 3.0 spec (ต้นทางของ Swagger UI)
  realtime/              # Socket.IO: index.js (io + auth), events.js (ชื่อ event), emit.js (ตัวช่วยยิง)
  lib/
    prisma.js            # PrismaClient + @prisma/adapter-pg
    access.js            # helper ตรวจสิทธิ์ (ownership / enrollment)
    grading.js           # ตรวจปรนัยอัตโนมัติ + คิดคะแนน/เกรด
    jwt.js, password.js  # ออก/ตรวจ token, hash รหัสผ่าน
    errors.js, serialize.js
  middleware/            # auth, validate (zod), error handler, rate limit
  services/              # business logic (auth, course, classroom, exam, submission, grading, result)
  routes/                # นิยาม endpoint ตามกลุ่ม (+ docs.routes.js สำหรับ Swagger UI)
  validators/common.js
prisma/
  schema.prisma          # โมเดลฐานข้อมูลทั้งหมด
  migrations/            # SQL migration
  seed.js                # ข้อมูลตัวอย่าง
prisma.config.js         # Prisma 7 CLI config (datasource + seed)
scripts/
  realtime-smoke.mjs     # ทดสอบ Socket.IO end-to-end (npm run test:realtime)
docs/REALTIME.md         # คู่มือชั้น realtime สำหรับ frontend
diagrams/                # ER Diagram + Flowcharts (Mermaid)
docker-compose.yml       # PostgreSQL สำหรับ dev
```

### หมายเหตุเฉพาะ Prisma 7

- Connection string อยู่ใน `prisma.config.js` (ใช้อ่านจาก `DATABASE_URL`) ไม่ได้อยู่ใน `schema.prisma`
- แอปต้องใช้ **driver adapter** (`@prisma/adapter-pg`) ตอนสร้าง `PrismaClient`
- CLI **ไม่อ่าน `.env` เอง** — โปรเจกต์นี้โหลดผ่าน `dotenv/config` ใน `prisma.config.js`
- `prisma generate` / `prisma db seed` ต้องรันเอง (ไม่ทำงานอัตโนมัติ)

---

## 📐 เอกสารออกแบบ (Diagrams)

โฟลเดอร์ [`diagrams/`](diagrams/README.md) มีเอกสารออกแบบที่เขียนด้วย Mermaid (แสดงผลบน GitHub ได้ทันที)

- [`ER_DIAGRAM.md`](diagrams/ER_DIAGRAM.md) — แผนผังฐานข้อมูล + Data Dictionary
- [`FLOWCHART.md`](diagrams/FLOWCHART.md) — ผังกระบวนการทำงานทุกส่วน

---

## 📄 License

MIT
