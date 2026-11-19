# 🎓 WA Education API — ระบบสอบออนไลน์ (Backend)

REST API + Realtime สำหรับระบบจัดการเรียนการสอนและการสอบออนไลน์ รองรับ **2 บทบาท** คือ
**ครู (Teacher)** และ **นักเรียน (Student)**

สร้างด้วย **Node.js 24 + Express 5 + Prisma 7 + PostgreSQL** เขียนเป็น JavaScript (ESM ล้วน, `"type": "module"`)
ส่วน Frontend (Vue) แยกโปรเจกต์ต่างหาก และคุยกับ API นี้ผ่าน REST + Socket.IO

> **จุดขายหลักของระบบ:** ตรวจปรนัยอัตโนมัติ, ครูตรวจอัตนัยพร้อมหมายเหตุรายข้อ,
> และการ **"ไม่ให้ผลสอบรั่ว"** — นักเรียนเห็นคะแนน/เฉลย/ความเห็นของครู **เฉพาะเมื่อครูกดปล่อยผลแล้วเท่านั้น**

---

## 📑 สารบัญ

- [ฟีเจอร์](#-ฟีเจอร์)
- [สถาปัตยกรรมและเทคโนโลยี](#-สถาปัตยกรรมและเทคโนโลยี)
- [โครงสร้างข้อมูล (Data Model)](#-โครงสร้างข้อมูล-data-model)
- [สิทธิ์การใช้งาน (RBAC)](#-สิทธิ์การใช้งาน-rbac)
- [กติกาทางธุรกิจที่สำคัญ](#-กติกาทางธุรกิจที่สำคัญ)
- [เริ่มต้นใช้งาน (Getting Started)](#-เริ่มต้นใช้งาน-getting-started)
- [คำสั่ง npm (Scripts)](#-คำสั่ง-npm-scripts)
- [บัญชีทดลอง (Demo Data)](#-บัญชีทดลอง-demo-data)
- [เอกสาร API (Swagger UI)](#-เอกสาร-api-swagger-ui)
- [ภาพรวม API + ตัวอย่างการเรียก](#-ภาพรวม-api--ตัวอย่างการเรียก)
- [รูปแบบ error และรหัสข้อผิดพลาด](#-รูปแบบ-error-และรหัสข้อผิดพลาด)
- [Rate Limiting](#-rate-limiting)
- [Realtime (Socket.IO)](#-realtime-socketio)
- [โครงสร้างโปรเจกต์](#-โครงสร้างโปรเจกต์)
- [หมายเหตุเฉพาะ Prisma 7](#-หมายเหตุเฉพาะ-prisma-7)
- [คู่มือนักพัฒนา (Development)](#-คู่มือนักพัฒนา-development)
- [การทดสอบ](#-การทดสอบ)
- [CI ด้วย Jenkins](#-ci-ด้วย-jenkins)
- [Troubleshooting](#-troubleshooting)
- [ความปลอดภัย (Security Notes)](#-ความปลอดภัย-security-notes)
- [ข้อจำกัดที่รู้อยู่ / แนวทางต่อยอด](#-ข้อจำกัดที่รู้อยู่--แนวทางต่อยอด)
- [เอกสารออกแบบ (Diagrams)](#-เอกสารออกแบบ-diagrams)
- [License](#-license)

---

## ✨ ฟีเจอร์

**ฝั่งครู**

- สมัคร/เข้าสู่ระบบแยกช่องทางจากนักเรียน (ล็อกอินผิดบทบาท → `403`)
- จัดการ **รายวิชา (Course)** → **ห้องเรียน (Classroom)** หลายห้องต่อวิชา
- ห้องเรียนมี **joinCode** ให้เองแบบสุ่มอัตโนมัติ ให้นักเรียนเข้าห้องเองได้
- จัดการนักเรียน: เพิ่มเข้าห้องด้วย `studentId` / `email` / `studentCode`, สร้างบัญชีใหม่พร้อม
  **รหัสผ่านชั่วคราว**, แก้ไข, ระงับการใช้งาน, รีเซ็ตรหัสผ่าน, เอานักเรียนออกจากห้องของตัวเอง
  - รหัสผ่านชั่วคราว: ถ้าครูไม่ระบุ ระบบ **สุ่มให้ 12 ตัวอักษร** (ไม่ใช้ `studentCode` เป็นรหัสผ่าน)
  - "ลบนักเรียน" = เอาเฉพาะ enrollment ในห้องของครูคนนี้ออก ไม่ลบบัญชี/ไม่แตะข้อมูลครูคนอื่น
- ค้นหานักเรียน/รายวิชาด้วย `?q=` และดูรายชื่อนักเรียนรวมทุกห้อง
- สร้างข้อสอบ: ปรนัย (MULTIPLE_CHOICE), ตอบสั้น (SHORT_ANSWER), ตอบยาว (LONG_ANSWER)
  กำหนดคะแนนรายข้อเอง, จัดลำดับข้อ, ใส่เฉลยอ้างอิง (referenceText) และคำอธิบายเฉลย (explanation)
- **นำเข้าข้อคำถามทีละหลายข้อจากไฟล์ CSV / Excel (.xlsx)** — ดาวน์โหลดแม่แบบได้จากระบบ
  ตรวจทุกแถวก่อนแบบ all-or-nothing (ผิดจะบอกเลขแถวให้แก้ ไม่บันทึกบางส่วน) และมี `?dryRun=true` ให้พรีวิวก่อนบันทึกจริง
- **จำกัด IP ที่เข้าทำข้อสอบ** (`allowedIpRanges`) — รับ IPv4/IPv6 และ CIDR เช่น `203.0.113.0/24`
  มี endpoint `GET /api/exams/request-ip` ให้ดู IP ปัจจุบันเพื่อคัดลอกไปตั้งค่า
- กำหนด **เกณฑ์ตัดเกรด A–F** แบบเปอร์เซ็นต์ (มีชุดมาตรฐานให้เป็นค่าเริ่มต้น)
- **มอบหมายข้อสอบให้ห้องเรียน** พร้อมกำหนดช่วงเวลาเปิด–ปิดของแต่ละห้อง
- เปิด/ปิดสอบ (DRAFT → PUBLISHED → CLOSED)
- ตรวจอัตนัย: ตัดสินถูก/ไม่ถูก + เขียนหมายเหตุ (ผิดเพราะอะไร / ถูกเพราะอะไร) + ปรับคะแนนได้
- **ปล่อยผล** แบบรายคน หรือทั้งชุด (ข้ามคนที่ยังตรวจไม่ครบ)
- หน้าตรวจรู้ว่ามีงานส่งเข้ามาใหม่ผ่าน realtime — ไม่ต้องกดรีเฟรช

**ฝั่งนักเรียน**

- สมัครสมาชิกพร้อม **joinCode** เพื่อเข้าห้องทันที, หรือเข้าห้องทีหลังด้วยรหัสห้อง
- ดูข้อสอบที่ได้รับมอบหมาย พร้อมธง `canStart`
- ทำข้อสอบได้ **1 ครั้งต่อข้อสอบ 1 ชุด** (unique `examId + studentId`)
- เลือกโหมดแสดงผลได้: หน้าเดียว (SINGLE_PAGE) หรือแบ่งหน้า (PAGINATED)
- มี **time limit** ได้ — เซิร์ฟเวอร์คำนวณ `expiresAt` ให้อัตโนมัติเมื่อเริ่มทำ
- บันทึกคำตอบระหว่างทำแบบ bulk ได้เรื่อย ๆ (ทำต่อจากใบเดิมได้ถ้ายังไม่ส่ง)
- ส่งข้อสอบ → ปรนัยตรวจทันที, สถานะ `SUBMITTED` = "ส่งแล้ว รอตรวจ"
- ดูผลสอบพร้อมเฉลย + คำอธิบาย + หมายเหตุครู (เมื่อถูกปล่อยผลแล้วเท่านั้น)

**ระดับระบบ**

- JWT access (อายุสั้น) + refresh token แบบ **rotate ทุกครั้ง** และเก็บแบบ **hashed (sha256)**
- Realtime (Socket.IO) บนพอร์ตเดียวกัน แจ้งเตือนการเปลี่ยนแปลงแบบทันที
- Swagger UI / OpenAPI 3.0 ให้ทดลองยิง API ได้จากเบราว์เซอร์
- Validate ทุก input ด้วย Zod, error มาตรฐานรูปแบบเดียว, rate limit กัน brute-force
- Seed ข้อมูลตัวอย่างพร้อมใช้ (ครู + นักเรียน 3 คน + ข้อสอบ 5 ข้อ + ผลสอบที่ปล่อยแล้ว 1 ใบ)

---

## 🧱 สถาปัตยกรรมและเทคโนโลยี

| ส่วน | เทคโนโลยี | หมายเหตุ |
| :--- | :--- | :--- |
| Runtime | Node.js **>= 24.18.0** | ESM, `"type": "module"`, pin ไว้ที่ `.nvmrc` |
| Web framework | Express **5** | async error ถูกส่งเข้า error handler อัตโนมัติ |
| ORM | Prisma **7** | `@prisma/client` + `@prisma/adapter-pg` (driver adapter) |
| Database | PostgreSQL | docker image `postgres:18-alpine` (host port 5433) |
| Validation | Zod **4** | ตรวจ `params` / `body` / `query` ต่อ endpoint |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` | access + refresh rotation |
| Security | `helmet`, CORS allow-list, `express-rate-limit` | |
| Realtime | Socket.IO **4** | path `/socket.io` บน HTTP server ตัวเดียวกับ REST |
| เอกสาร API | `swagger-ui-express` + OpenAPI 3.0 | spec เก็บใน `src/docs/openapi.js` |
| นำเข้าไฟล์ | `multer` (รับไฟล์) + `csv-parse` + `exceljs` | CSV / Excel สำหรับนำเข้าข้อคำถาม |
| Logging | `morgan` | `dev` ตอนพัฒนา / `combined` ตอน production |

### ภาพรวมสถาปัตยกรรม

```
        ┌───────────────────────────────┐
        │  Frontend (Vue 3 + Vite)       │  ← แยกโปรเจกต์
        └───────┬───────────────┬───────┘
                │ REST (fetch)  │ WebSocket (socket.io-client)
                │ Authorization │ auth: { token: accessToken }
                │ Bearer <JWT>  │
                ▼               ▼
        ┌────────────────────────────────────────────────┐
        │  Express 5 — src/app.js                        │
        │  helmet · cors(allow-list) · morgan · json 1mb │
        │                                                │
        │  middleware/  authenticate → requireRole       │
        │               validate(zod) → errorHandler     │
        │                                                │
        │  routes/  ──►  services/  ──►  lib/ (prisma,   │
        │  (HTTP)        (business)      grading, access)│
        └───────┬────────────────────────────────┬───────┘
                │ Prisma Client + pg adapter     │ Socket.IO
                ▼                                ▼
        ┌──────────────────┐          ┌────────────────────────┐
        │   PostgreSQL     │          │  sockets (room ต่อ user) │
        │                  │          │  user:<userId>           │
        └──────────────────┘          └────────────────────────┘
```

### ลำดับการทำงานของ request หนึ่งครั้ง

1. `helmet` → `cors` → `express.json` → `morgan`
2. เข้า `authenticate` (อ่าน `Authorization: Bearer <access token>`, โหลด user จาก DB แล้วแนบ `req.user`)
3. `requireRole` / `teacherOnly` / `studentOnly` ตรวจบทบาท
4. `validate({ params, body, query })` ตรวจด้วย Zod — ผ่านแล้วเขียนค่าที่ coerce กลับลง `req`
   (หมายเหตุ: `req.query` ของ Express 5 เขียนทับไม่ได้ จึงเก็บไว้ที่ `req.validatedQuery`)
5. route handler เรียก service → service ใช้ helper ใน `lib/access.js` ตรวจ ownership/enrollment ก่อนแตะข้อมูล
6. สำเร็จ → ส่ง JSON · ล้มเหลว → `throw ApiError` แล้ว `errorHandler` แปลงเป็น JSON รูปแบบเดียว

---

## 🗂 โครงสร้างข้อมูล (Data Model)

```
Course (รายวิชา)
  └── Classroom (ห้องเรียน)  ← มี joinCode ให้นักเรียนเข้าห้องเองได้
        └── Enrollment (การเข้าเรียนของนักเรียน)
              └── ExamAssignment (มอบหมายข้อสอบให้ห้องเรียน + ช่วงเวลาเปิด/ปิด)
                    └── Exam (ข้อสอบ)
                          ├── Question (คำถาม: MULTIPLE_CHOICE / SHORT_ANSWER / LONG_ANSWER, มีคะแนนต่อข้อ)
                          │     └── Choice (ตัวเลือกของข้อปรนัย + เฉลย isCorrect)
                          ├── GradeCutoff (เกณฑ์ตัดเกรด A–F ตามเปอร์เซ็นต์)
                          └── Submission (การส่งข้อสอบของนักเรียน 1 คน = 1 ครั้ง)
                                └── Answer (คำตอบรายข้อ + คะแนนที่ได้ + หมายเหตุของครู)

User ─┬─ role TEACHER → เป็นเจ้าของ Course / Classroom / Exam
      ├─ role STUDENT → มี Enrollment / Submission
      └── RefreshToken (เก็บ refresh token แบบ hashed)
```

### Enum ที่ใช้ทั้งระบบ

| Enum | ค่า | ความหมาย |
| :--- | :--- | :--- |
| `Role` | `TEACHER`, `STUDENT`, `ADMIN` | บทบาทผู้ใช้ (`ADMIN` เข้าได้ทั้งฝั่งครูและนักเรียน) |
| `ExamStatus` | `DRAFT` → `PUBLISHED` → `CLOSED` | สถานะข้อสอบ (นักเรียนเห็นเฉพาะ `PUBLISHED`) |
| `QuestionType` | `MULTIPLE_CHOICE`, `SHORT_ANSWER`, `LONG_ANSWER` | ประเภทคำถาม |
| `DisplayMode` | `SINGLE_PAGE`, `PAGINATED` | โหมดแสดงผลข้อสอบ (เก็บต่อการส่ง 1 ครั้ง) |
| `SubmissionStatus` | `IN_PROGRESS` → `SUBMITTED` → `GRADED` → `RELEASED` | สถานะการส่งข้อสอบ |

### ตารางฐานข้อมูล (สรุปฟิลด์สำคัญ)

| Model | ตาราง | ฟิลด์เด่น | กติกาที่บังคับใน DB |
| :--- | :--- | :--- | :--- |
| `User` | `users` | `email` (unique), `passwordHash`, `fullName`, `role`, `studentCode` (unique, nullable), `isActive` | index ที่ `role` |
| `RefreshToken` | `refresh_tokens` | `tokenHash` (unique), `expiresAt`, `revokedAt`, `userAgent` | cascade เมื่อ user ถูกลบ |
| `Course` | `courses` | `code`, `title`, `description`, `teacherId` | unique `[teacherId, code]` |
| `Classroom` | `classrooms` | `name`, `joinCode` (unique), `courseId` (nullable), `teacherId` | joinCode สุ่มอัตโนมัติ 6 ตัว |
| `Enrollment` | `enrollments` | `classroomId`, `studentId`, `enrolledAt` | unique `[classroomId, studentId]` |
| `Exam` | `exams` | `title`, `status`, `timeLimitMinutes?`, `allowedIpRanges[]`, `defaultDisplayMode`, `questionsPerPage`, `totalsPoints` | `courseId` on delete → `SetNull` |
| `ExamAssignment` | `exam_assignments` | `availableFrom?`, `availableTo?` | unique `[examId, classroomId]` |
| `Question` | `questions` | `type`, `prompt`, `points`, `order`, `referenceText?`, `explanation?` | cascade เมื่อ exam ถูกลบ |
| `Choice` | `choices` | `label`, `text`, `isCorrect`, `order` | unique `[questionId, label]` |
| `GradeCutoff` | `grade_cutoffs` | `grade`, `minPercent` (ขอบล่างแบบรวม) | unique `[examId, grade]` |
| `Submission` | `submissions` | `status`, `displayMode`, `startedAt`, `expiresAt?`, `submittedAt?`, `gradedAt?`, `releasedAt?`, `autoScore`, `manualScore`, `totalScore`, `percent`, `grade?` | unique `[examId, studentId]` = 1 ครั้ง/คน/ชุด |
| `Answer` | `answers` | `choiceId?`, `textAnswer?`, `isCorrect?` (null = ยังไม่ตรวจ), `autoGraded`, `awardedPoints?`, `graderComment?`, `gradedById?`, `gradedAt?` | unique `[submissionId, questionId]` |

**หมายเหตุการคำนวณคะแนน:** `totalScore = autoScore + manualScore`,
`percent = totalScore / totalsPoints × 100` และ `grade` ได้จากการเทียบ `percent`
กับ `GradeCutoff` ที่มี `minPercent` สูงสุดซึ่งยัง `<= percent`

ดู ER Diagram ฉบับเต็ม + Data Dictionary ได้ที่ [`diagrams/ER_DIAGRAM.md`](diagrams/ER_DIAGRAM.md)

---

## 🔐 สิทธิ์การใช้งาน (RBAC)

ระบบแยกช่องทางเข้าใช้งานตามบทบาท และบังคับที่ Middleware
(`authenticate` + `requireRole('TEACHER')` / `requireRole('STUDENT')`)

| บทบาท | สิทธิ์หลัก |
| :--- | :--- |
| **TEACHER** | จัดการรายวิชา, ห้องเรียน, นักเรียน (เพิ่ม/แก้ไข/ลบ + ปุ่ม "+"), สร้างและแก้ไขข้อสอบ, กำหนดเกณฑ์ตัดเกรด, มอบหมายข้อสอบ, ตรวจอัตนัย, ปล่อยผลสอบ |
| **STUDENT** | เข้าห้องเรียนด้วยรหัส, ดูข้อสอบที่ได้รับมอบหมาย, ทำข้อสอบ, ดูผลสอบ **หลังครูกดปล่อยผลแล้วเท่านั้น** |

### การยืนยันตัวตน (Authentication)

- `POST /api/auth/login` ต้องส่ง `role` (`TEACHER` / `STUDENT`) มาด้วยเสมอ
  — ล็อกอินผิดช่องทางจะได้ `403` พร้อมบอกว่าบัญชีนี้เป็นบทบาทอะไร
  — บัญชี `ADMIN` เข้าสู่ระบบได้ทั้งช่องทางนักเรียนและครู
- ใช้ **access token (อายุสั้น, ค่าเริ่มต้น 15 นาที)** แนบ `Authorization: Bearer <token>`
- **refresh token** (ค่าเริ่มต้น 7 วัน) ถูก **rotate ทุกครั้ง** ที่ต่ออายุ — ตัวเก่าถูกเพิกถอนทันที
  และเก็บใน DB แบบ **hashed sha256** (`tokenHash` unique) ถ้า DB รั่วก็ยังปลอม token ไม่ได้
- `POST /api/auth/logout` เพิกถอน refresh token (`204 No Content`)
- `PATCH /api/auth/password` เปลี่ยนรหัสผ่านของบัญชีตัวเอง (นักเรียน/ครู/ผู้ดูแล)
  — ต้องส่ง `currentPassword` + `newPassword` (8–72 ตัว, ต้องไม่ซ้ำของเดิม)
  — สำเร็จแล้ว refresh token **ทุกตัว** ของบัญชีนั้นถูกเพิกถอน (เครื่องอื่นต้องล็อกอินใหม่) และคืน token ชุดใหม่ให้เครื่องที่เรียก
- บัญชีที่ `isActive = false` จะถูกปฏิเสธทุกเส้นทาง (รวมถึงตอน refresh)
- access token เก็บ issuer `wa-education-api` และมี `type: 'access' | 'refresh'` — ใช้สลับกันไม่ได้

### Ownership / Enrollment check

ทุก endpoint ของครูจะตรวจว่า **ข้อมูลเป็นของครูคนนั้นจริง** ก่อนทำงาน
(ผ่าน helper ใน `src/lib/access.js`) จึงไม่มีทางที่ครูคนหนึ่งจะเห็น/แก้ข้อมูลของครูอีกคน:

| Helper | ตรวจอะไร | ถ้าไม่ผ่าน |
| :--- | :--- | :--- |
| `getOwnedCourse` | `course.teacherId === teacherId` | `404` (ไม่พบ) หรือ `403` (ไม่ใช่ของคุณ) |
| `getOwnedClassroom` | `classroom.teacherId === teacherId` | เหมือนกัน |
| `getOwnedExam` | `exam.teacherId === teacherId` | เหมือนกัน |
| `getOwnedSubmission` | เจ้าของ `exam` ของ submission นั้น | เหมือนกัน |
| `getOwnStudentSubmission` | `submission.studentId === studentId` | `403` "การส่งข้อสอบนี้ไม่ใช่ของคุณ" |
| `getExamForStudent` | ข้อสอบ `PUBLISHED` + นักเรียนอยู่ในห้องที่ถูกมอบหมาย + อยู่ในช่วงเวลา | `403` พร้อมเหตุผล |

> `getExamForStudent` ยังใช้ตรวจ **ช่วงเวลาเปิด–ปิด** ของ `ExamAssignment`
> (`ยังไม่ถึงเวลาทำข้อสอบ` / `เลยเวลาทำข้อสอบแล้ว`) ก่อนเริ่มทำหรือดึงข้อสอบเสมอ

---

## 📏 กติกาทางธุรกิจที่สำคัญ

### 1) การสร้างข้อสอบ (ฝั่งครู)

- **ข้อปรนัยต้องมีตัวเลือกอย่างน้อย 2 ตัว และมีเฉลยที่ถูกต้อง 1 ตัวเท่านั้น** → ไม่งั้น `400`
- ข้ออัตนัย (`SHORT_ANSWER` / `LONG_ANSWER`) ใช้ `referenceText` เป็นคำตอบอ้างอิง (ครูตอบเอง) และมี `explanation` ได้
- `points` ต่อข้อต้องมากกว่า 0 (ไม่เกิน 1000) — `exam.totalsPoints` ถูกคำนวณใหม่ให้อัตโนมัติทุกครั้งที่เพิ่ม/แก้/ลบข้อ
- จัดลำดับข้อได้ด้วย `PUT /api/exams/:examId/questions/order`
- **นำเข้าข้อคำถามจากไฟล์:** `POST /api/exams/:examId/questions/import` (multipart ฟิลด์ `file`, `.csv`/`.xlsx` ≤ 5 MB, ≤ 500 ข้อ/ครั้ง)
  - โครงไฟล์เหมือนแม่แบบจาก `GET /api/exams/questions/import-template` (1 แถว = 1 ข้อ) · อ่าน CSV ได้ทั้ง UTF-8 และ Excel ANSI/CP874 (ภาษาไทยไม่เพี้ยน)
  - ตรวจ **ทุกแถวก่อน** แบบ all-or-nothing: ถ้ามีแถวผิดจะไม่บันทึกสักข้อ แล้วคืน `error.details = [{ row, message }]` (HTTP `400`)
  - `?dryRun=true` → ตรวจและพรีวิวโดยไม่บันทึก (HTTP `200`) · ทำได้เฉพาะชุดข้อสอบสถานะ `DRAFT` (ไม่งั้น `409`)
  - นำเข้าซ้ำได้เรื่อย ๆ — ลำดับข้อจะ **ต่อจากข้อสุดท้าย** และ `totalsPoints` ถูกคำนวณใหม่ให้อัตโนมัติ
- **จำกัด IP ที่เข้าทำข้อสอบ:** ตั้ง `allowedIpRanges` ตอนสร้าง/แก้ข้อสอบ (รับ IPv4/IPv6 และ CIDR เช่น `203.0.113.0/24`, `2001:db8::/32`)
  - `[]` (ค่าเริ่มต้น) = ไม่จำกัด · สูงสุด 50 รายการ · ระบบตัดช่องว่าง/รายการซ้ำให้ · รูปแบบผิด → `400`
  - `GET /api/exams/request-ip` ช่วยดู IP ปัจจุบันของครู เพื่อคัดลอกไปใส่ได้
- **เกณฑ์ตัดเกรด:** ใส่เกรดซ้ำกันไม่ได้ (`400`) และการเปลี่ยนเกณฑ์จะ **คำนวณเกรดของทุกใบที่ส่งแล้วใหม่ทันที**
- **ลบข้อสอบ** ที่มีการส่งคำตอบแล้วจะถูกบล็อก (`409`) — ต้องส่ง `?force=true` ถ้าต้องการลบจริง
- **ลบห้องเรียน** ที่มีข้อสอบซึ่งมีการส่งคำตอบแล้วจะถูกบล็อก (`409`) เพื่อไม่ให้ประวัติคะแนนหาย

### 2) การเปิด–ปิดสอบ (Publish / Close)

- `POST /api/exams/:examId/publish` จะล้มเหลว (`400`) ถ้า **ยังไม่มีข้อคำถาม** หรือ **ยังไม่ได้มอบหมายให้ห้องเรียนใดเลย**
- ตอน publish ถ้ายังไม่ตั้งเกณฑ์ตัดเกรด ระบบจะใส่ **A–F มาตรฐาน** ให้ก่อนอัตโนมัติ
- publish แล้วนักเรียนในห้องที่ถูกมอบหมายจะได้ event `exam:published` (ยิงเฉพาะ **ครั้งแรก** ที่เปลี่ยนสถานะ)
- `POST /api/exams/:examId/close` ตั้งสถานะเป็น `CLOSED` (นักเรียนทำ/ดึงข้อสอบไม่ได้แล้ว)

### 3) การทำข้อสอบ (ฝั่งนักเรียน)

- เริ่มทำ: `POST /api/my/exams/:examId/submissions`
  - ข้อสอบต้อง `PUBLISHED` + มอบหมายให้ห้องที่นักเรียนอยู่ + อยู่ในช่วงเวลา
  - ยังไม่มีข้อคำถาม → `400` "ข้อสอบชุดนี้ยังไม่มีข้อคำถาม"
  - ถ้าเคยเริ่มไว้และยังไม่ส่ง → คืน **ใบเดิม** ให้ทำต่อ (ไม่สร้างซ้ำ)
  - ถ้าส่งไปแล้ว → `409` "คุณส่งข้อสอบชุดนี้แล้ว"
  - ถ้ามี `timeLimitMinutes` ระบบตั้ง `expiresAt = now + timeLimitMinutes`
  - ถ้าข้อสอบตั้ง `allowedIpRanges` ไว้ และ IP ของเครื่องที่เรียก **ไม่อยู่ในรายการ** → `403` "เครื่องนี้ไม่ได้รับอนุญาต…(จำกัด IP)"
    - ตรวจเฉพาะตอน **เข้าทำ** (ดึงรายละเอียดข้อสอบ + เริ่มทำ) เท่านั้น — ถ้าเริ่มทำไปแล้วแล้วเน็ตเปลี่ยน ยังบันทึก/ส่งคำตอบได้ ไม่เสียคำตอบ
- เลือกโหมดแสดงผล `SINGLE_PAGE` / `PAGINATED` ได้ (ค่าเริ่มต้น = `exam.defaultDisplayMode`)
- บันทึกคำตอบ: `PUT /api/my/submissions/:submissionId/answers` (bulk 1–200 รายการ)
  - บันทึกได้เฉพาะตอน `IN_PROGRESS` และยังไม่หมดเวลา — ไม่งั้น `409`
  - `save` ล็อกแถว submission ร่วมกับ `submit` → request ที่มาช้าได้ `409` และเขียนทับคำตอบหลังส่งไม่ได้
  - `choiceId` ใช้ได้กับข้อปรนัยเท่านั้น, ข้ออัตนัยห้ามส่ง `choiceId`
  - `textAnswer` ยาวได้ไม่เกิน 20,000 ตัวอักษร
- ส่งข้อสอบ: `POST /api/my/submissions/:submissionId/submit`
  - ระบบจะสร้าง `Answer` **ครบทุกข้อ** (ข้อที่เว้นว่างก็มี record → ครูเห็นว่าเว้นว่าง)
  - ปรนัยตรวจอัตโนมัติทันที, อัตนัยยัง `isCorrect = null` (รอครูตรวจ)
  - ตั้งสถานะ `SUBMITTED` + `submittedAt` และคำนวณคะแนน แล้วแจ้งครูเจ้าของข้อสอบ
  - **response ไม่มีคะแนน/เกรด** จนกว่าครูจะปล่อยผล (`RELEASED`)
  - ใบที่เริ่มทำไว้แล้ว **ยัง submit ได้แม้หมดเวลาหรือข้อสอบถูกปิด** (กันนักเรียนเสียคำตอบ)
    แต่การบันทึกเพิ่ม/เริ่มใหม่จะถูกบล็อกตามเวลาและสถานะปกติ

### 4) การตรวจและตัดเกรด

- **ปรนัย (MULTIPLE_CHOICE)** ตรวจอัตโนมัติทันทีที่นักเรียนกดส่ง โดยเทียบกับเฉลย → นับเข้า `autoScore`
- **อัตนัย (SHORT_ANSWER / LONG_ANSWER)** ครูตรวจเองที่ `PATCH /api/grading/answers/:answerId`:
  - ต้องระบุ `isCorrect` (บังคับ) + `graderComment` (หมายเหตุ: ผิดเพราะอะไร / ถูกเพราะอะไร)
  - ปรับ `awardedPoints` ได้ (ค่าเริ่มต้น = คะแนนเต็มถ้าถูก, 0 ถ้าไม่ถูก) — ต้องอยู่ระหว่าง `0` ถึงคะแนนเต็มข้อ
  - ตรวจข้อปรนัยด้วยมือ → `400` "ข้อปรนัยถูกตรวจอัตโนมัติแล้ว"
  - ตรวจใบที่นักเรียนยังไม่ส่ง → `409`
  - คะแนนจากอัตนัยนับเข้า `manualScore`
- เมื่อ **ตรวจครบทุกข้อ** สถานะเปลี่ยนเป็น `GRADED`, คำนวณ `totalScore`, `percent` และเทียบเกณฑ์ตัดเกรด A–F ให้อัตโนมัติ
- ถ้ามีการแก้ไขข้อสอบ/เกณฑ์ ระบบจะคำนวณคะแนนของทุกใบที่ส่งแล้วใหม่ให้ (ยกเว้นใบที่ยัง `IN_PROGRESS`)

### 5) การไม่ให้ผลสอบรั่ว (Release Gate + Anti-Leak)

**Release Gate**

- นักเรียนดูคะแนน / เฉลย / หมายเหตุของครู **ไม่ได้** จนกว่าครูจะกด **"ส่งผลไปให้นักเรียน"**
- บังคับที่ระดับ Service: ถ้า `status !== 'RELEASED'` จะตอบ `403` พร้อมข้อความ
  "ผลสอบยังไม่ถูกปล่อย กรุณารอครูประกาศผล"
- `POST /api/grading/submissions/:submissionId/release` (รายคน) จะ `422` ถ้ายังตรวจไม่ครบ (บอกว่าขาดอีกกี่ข้อ)
- `POST /api/grading/exams/:examId/release` (ทั้งชุด) จะปล่อยเฉพาะคนที่ตรวจครบและคืน
  `{ released, skipped, message }` — คนที่ยังตรวจไม่ครบจะถูก **ข้าม** ไม่ error
- แม้ปล่อยผลแล้ว นักเรียนคนอื่นก็ยังเข้าดูผลของเพื่อนไม่ได้ (owner check → `403`)

**Anti-Leak payload**

- ตอนนักเรียนดูกระดาษข้อสอบ (`GET /api/my/exams/:examId`) ระบบ **ตัดฟิลด์**
  `isCorrect`, `explanation`, `referenceText` และ `points` ออกจาก response ทั้งหมด
  (ข้อปรนัยส่งมาแค่ `{ id, label, text, order }`)
- **ทุก endpoint ฝั่งนักเรียน** ที่คืน submission (`start`, `GET /api/my/submissions/:id`,
  `submit`, `GET /api/my/exams/:examId`) จะตัด `autoScore`, `manualScore`, `totalScore`,
  `percent`, `grade`, `gradedAt`, `releasedAt` ออกจนกว่า `status === 'RELEASED'`
  (ใช้ whitelist ใน `serializeStudentSubmission` เพื่อกันฟิลด์ใหม่หลุดในอนาคต)
- ในรายการข้อสอบ (`GET /api/my/exams`) จะโชว์ `totalScore` / `percent` / `grade`
  **เฉพาะใบที่ `RELEASED`** เท่านั้น
- ในหน้าผลสอบ (`GET /api/my/results`) จะโชว์คะแนนเฉพาะเมื่อ `RELEASED`
  มิฉะนั้นส่งมาแค่สถานะ + `pendingTeacherAction: true`

---

## 🚀 เริ่มต้นใช้งาน (Getting Started)

### 0. สิ่งที่ต้องมี

- **Node.js 24.18.0** — ระบุไว้ใน `.nvmrc` และ `package.json` → `engines`
  ถ้าใช้ nvm ให้รัน `nvm use` (หรือ `nvm install` ครั้งแรก) แล้วเช็ค `node -v` ต้องขึ้น `v24.18.0`
- **PostgreSQL** — จะใช้ผ่าน Docker หรือตัวที่ติดตั้งในเครื่องก็ได้

### 1. ติดตั้ง dependencies

```bash
npm install
```

### 2. เตรียมไฟล์ environment

```bash
cp .env.example .env
```

จากนั้นแก้ค่าใน `.env` — ค่าทั้งหมดที่อ่านได้ (ดูจริงใน `.env.example`):

| ตัวแปร | ค่าเริ่มต้น | จำเป็น | คำอธิบาย |
| :--- | :--- | :---: | :--- |
| `NODE_ENV` | `development` | | `development` / `test` / `production` |
| `PORT` | `4000` | | พอร์ตที่ REST + Socket.IO ใช้ร่วมกัน |
| `DATABASE_URL` | — | ✅ | connection string ของ PostgreSQL (บังคับ) |
| `JWT_ACCESS_SECRET` | — | ✅ | ความลับของ access token (ยาว ≥ 16 ตัวอักษร) |
| `JWT_REFRESH_SECRET` | — | ✅ | ความลับของ refresh token (ยาว ≥ 16 ตัวอักษร) |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | | อายุ access token |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | | อายุ refresh token |
| `BCRYPT_ROUNDS` | `10` | | ค่า cost ของ bcrypt (4–15) |
| `CORS_ORIGIN` | `http://localhost:5173` | | allow-list ของ origin (คั่นหลายค่าด้วย `,`) ใช้ทั้ง REST และ Socket.IO |
| `DOCS_ENABLED` | (ไม่ตั้งค่า) | | เปิด/ปิด Swagger UI — ไม่ตั้งค่า = เปิดใน dev/test, ปิดใน production (ถ้าใส่ใน `.env` ต้องเป็น `true`/`false` เท่านั้น ค่าว่างจะทำให้ config ไม่ผ่าน) |
| `LOGIN_RATE_LIMIT_MAX` | `10` | | เพดานล็อกอินต่อ 15 นาที/ต่อ IP **เฉพาะ dev/test** (production ตรึง 10 ไว้ในโค้ด) |
| `REGISTER_RATE_LIMIT_MAX` | `20` | | เพดานสมัครสมาชิกต่อ 1 ชั่วโมง/ต่อ IP **เฉพาะ dev/test** (production ตรึง 20) |
| `RATE_LIMIT_DISABLED` | (ไม่ตั้งค่า) | | `true` = ปิด rate limit ทั้งหมด (ใช้ได้เฉพาะเมื่อ `NODE_ENV` ไม่ใช่ `production`) |

```env
NODE_ENV=development
PORT=4000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/wa_education?schema=public"
JWT_ACCESS_SECRET="change-me-access-secret"
JWT_REFRESH_SECRET="change-me-refresh-secret"
CORS_ORIGIN=http://localhost:5173
DOCS_ENABLED=true
```

> - สร้าง secret จริงด้วย `openssl rand -base64 48`
> - แอปจะ **validate env ด้วย zod ตอนบูต** ถ้าค่าไหนผิด/ขาดจะพิมพ์บอกแล้ว `process.exit(1)` (ไม่สตาร์ต)
>   เช่น ถ้า secret สั้นกว่า 16 ตัวอักษรก็จะไม่ผ่านตั้งแต่ต้น

### 3. เตรียมฐานข้อมูล PostgreSQL

เลือกวิธีใดวิธีหนึ่ง:

**ใช้ Docker (แนะนำ)**

```bash
docker compose up -d
# ฐานข้อมูลจะอยู่ที่ host port 5433 → ปรับ DATABASE_URL เป็น ...localhost:5433...
```

> compose ใช้ `postgres:18-alpine`, DB name `wa_education`, ผูก host port `5433` (เลี่ยงชนกับ
> PostgreSQL ในเครื่องที่มักอยู่ 5432) และมี healthcheck `pg_isready` ให้แล้ว

**ใช้ PostgreSQL ที่ติดตั้งในเครื่อง** — สร้าง database ชื่อ `wa_education`

### 4. สร้างตารางและข้อมูลตัวอย่าง

```bash
npm run migrate:deploy   # apply migration ทั้งหมด (production-style)
npm run seed             # สร้างข้อมูลตัวอย่าง (ครู + นักเรียน + ข้อสอบ)
```

> ถ้ากำลังพัฒนาสคีมาและอยากสร้าง migration ใหม่ ให้ใช้ `npm run migrate` (`prisma migrate dev`) แทน
> Prisma 7 **ไม่ auto-generate client** และ **ไม่ auto-seed** ให้หลัง migrate —
> ถ้าต้องการ client ใหม่ให้รัน `npm run generate` และ seed ด้วย `npm run seed` เอง

### 5. รันเซิร์ฟเวอร์

```bash
npm run dev    # โหมดพัฒนา (--watch, รีสตาร์ตเมื่อไฟล์เปลี่ยน)
npm start      # โหมดปกติ
```

ตรวจสอบว่าเซิร์ฟเวอร์ทำงาน:

```bash
curl http://localhost:4000/health
# { "status": "ok", "uptime": 1.23, "timestamp": "..." }
```

---

## 📜 คำสั่ง npm (Scripts)

| คำสั่ง | ทำอะไร |
| :--- | :--- |
| `npm run dev` | รันด้วย `node --watch src/server.js` (auto-reload) |
| `npm start` | รันแบบ production (`node src/server.js`) |
| `npm run generate` | `prisma generate` — สร้าง Prisma Client |
| `npm run migrate` | `prisma migrate dev` — สร้าง/apply migration ในโหมดพัฒนา |
| `npm run migrate:deploy` | `prisma migrate deploy` — apply migration ที่มีอยู่ทั้งหมด |
| `npm run studio` | เปิด Prisma Studio ดูข้อมูลในเบราว์เซอร์ |
| `npm run seed` | `prisma db seed` — ใส่ข้อมูลตัวอย่าง |
| `npm run reset` | `prisma migrate reset --force` — ลบ DB, migrate ใหม่, seed ใหม่ (**ข้อมูลหายทั้งหมด**) |
| `npm run test:realtime` | Smoke test ชั้น realtime (ต้องมีเซิร์ฟเวอร์รันค้างไว้ + seed แล้ว) |
| `npm run test:db` | เตรียมฐานข้อมูลเทสต์ (สร้างถ้ายังไม่มี + `prisma migrate deploy`) — ใช้ใน CI |
| `npm run test:unit` | Unit test (ไม่แตะฐานข้อมูล) |
| `npm run test:integration` | Integration test (ใช้ฐานข้อมูลเทสต์จริง) |
| `npm test` | รันทั้ง unit + integration |
| `npm run test:coverage` | รันทั้งชุดพร้อมรายงาน coverage |
| `npm run test:ci` | รันทั้งชุดสำหรับ CI → JUnit XML + LCOV (ดูหัวข้อ Jenkins) |

---

## 👥 บัญชีทดลอง (Demo Data)

สร้างโดย `npm run seed` (ถ้ามีข้อมูลอยู่แล้วจะข้าม ไม่ทับของเดิม)

| บทบาท | อีเมล | รหัสผ่าน | หมายเหตุ |
| :--- | :--- | :--- | :--- |
| ครู | `teacher@demo.local` | `Teacher123!` | "ครูสมชาย ใจดี" |
| ผู้ดูแล | `foqw007100@gmail.com` | `wa1234` | เข้าได้ทั้งฝั่งนักเรียนและครู (`ADMIN`) |
| นักเรียน | `student1@demo.local` | `Student123!` | `S001` — **มีผลสอบที่ปล่อยแล้ว** (7/10 → เกรด B) |
| นักเรียน | `student2@demo.local` | `Student123!` | `S002` |
| นักเรียน | `student3@demo.local` | `Student123!` | `S003` |

- ห้องเรียนเริ่มต้น **18 ห้อง** `ม.1/1`–`ม.6/3` (ระดับละ 3 ห้อง) **ไม่ผูกกับรายวิชา**
- รหัสเข้าห้องเรียน (joinCode): **`MATH41`** สำหรับห้อง "ม.4/1" (ห้องอื่นสุ่มให้อัตโนมัติ)
- ข้อมูลตัวอย่างมาพร้อมข้อสอบ **"สอบกลางภาค คณิตศาสตร์ ม.4"** 5 ข้อ (ปรนัย 3 + อัตนัย 2, คะแนนเต็ม 10)
  จำกัดเวลา 60 นาที โหมด `PAGINATED` 3 ข้อ/หน้า พร้อมเกณฑ์ตัดเกรด A–F และมอบหมายให้ห้อง MATH41
  (มี `availableFrom` = เมื่อวาน, `availableTo` = อีก 7 วัน)
- `student1` มีใบส่งที่ตรวจครบและ **ปล่อยผลแล้ว** (autoScore 4 + manualScore 3 = 7/10 = 70% → B)
  จึงลองล็อกอินเป็น `student1` เพื่อดูหน้าผลสอบได้ทันที

---

## 📘 เอกสาร API (Swagger UI)

โปรเจกต์มีเอกสาร API แบบอินเทอร์แอกทีฟให้แล้ว (OpenAPI 3.0) — **ไม่ต้องเขียน Swagger annotation ในโค้ด**
แต่เก็บ spec ไว้ที่ [`src/docs/openapi.js`](src/docs/openapi.js) ที่เดียว

| ปลายทาง | รายละเอียด |
| :--- | :--- |
| `GET /api/docs` | **Swagger UI** — ดูทุก endpoint และกด **Try it out** ยิง API จริงได้เลย |
| `GET /api/docs/openapi.json` | OpenAPI spec (JSON) — ใช้ import เข้า Postman / Insomnia / codegen |

วิธีใช้:

1. รันเซิร์ฟเวอร์ (`npm run dev`) แล้วเปิด <http://localhost:4000/api/docs>
2. กด **Authorize** 🔓 แล้ววาง `accessToken` ที่ได้จาก `POST /api/auth/login`
   (หรือกด Try it out ที่ `/api/auth/login` ด้วยบัญชีตัวอย่างก่อน)
3. token จะถูกจำไว้ในเบราว์เซอร์ (`persistAuthorization: true`) จึงยิง endpoint อื่นต่อได้ทันที

**เปิด/ปิดเอกสาร** ด้วย env `DOCS_ENABLED`

- ไม่ตั้งค่า → เปิดใน `development` / `test`, **ปิดอัตโนมัติใน `production`**
- `DOCS_ENABLED=false` → ปิดทุกโหมด
- `DOCS_ENABLED=true` → เปิดแม้ใน production (ระวัง: เผยโครงสร้าง API ให้สาธารณะ)

> ถ้าใส่ `DOCS_ENABLED` ใน `.env` ต้องเป็น `true` หรือ `false` เท่านั้น — ปล่อยค่าว่าง (`DOCS_ENABLED=`) จะทำให้ env validation ไม่ผ่านและเซิร์ฟเวอร์เริ่มไม่ได้

> เมื่อเพิ่ม endpoint ใหม่ อย่าลืมอัปเดต `src/docs/openapi.js` ด้วยจะได้ตรงกับของจริง

---

## 🌐 ภาพรวม API + ตัวอย่างการเรียก

**Base path:** `/api` — ทุก endpoint (ยกเว้น auth และ `/health`) ต้องแนบ Bearer token
รันเซิร์ฟเวอร์แล้วเปิด **<http://localhost:4000/api/docs>** เพื่อดูฉบับอินเทอร์แอกทีฟ

### Endpoint ระดับระบบ

| Method | Path | Auth | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| GET | `/api` | — | metadata ของ API (ชื่อ, เวอร์ชัน, ลิงก์ docs/endpoints) |
| GET | `/health` | — | health check (`status`, `uptime`, `timestamp`) |

### Auth — `/api/auth`

| Method | Path | Auth | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| POST | `/teacher/register` | — | ครูสมัครสมาชิก (คืน user + tokens, `201`) |
| POST | `/student/register` | — | นักเรียนสมัครสมาชิก (แนบ `joinCode` เพื่อเข้าห้องทันที) |
| POST | `/login` | — | เข้าสู่ระบบ (ต้องส่ง `role`) |
| POST | `/refresh` | — | ต่ออายุ token (rotate refresh token) |
| POST | `/logout` | — | ออกจากระบบ (เพิกถอน refresh token, `204`) |
| GET | `/me` | Bearer | ข้อมูลผู้ใช้ปัจจุบัน |

### ครู (Teacher)

| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| GET/POST | `/api/courses` | รายวิชา: ดูทั้งหมด (รองรับ `?q=`) / สร้างใหม่ |
| GET/PATCH/DELETE | `/api/courses/:courseId` | รายละเอียด / แก้ไข / ลบ |
| GET/POST | `/api/classrooms` | ห้องเรียน: ดูทั้งหมด (รองรับ `?courseId=`) / สร้างใหม่ |
| GET/PATCH/DELETE | `/api/classrooms/:classroomId` | รายละเอียด (รวม students + examAssignments) / แก้ไข / ลบ |
| GET | `/api/classrooms/:classroomId/students` | รายชื่อนักเรียนในห้อง |
| GET | `/api/classrooms/:classroomId/students/export` | ส่งออกรายชื่อนักเรียนในห้องเป็น CSV (UTF-8 เปิดใน Excel ได้) |
| POST | `/api/classrooms/:classroomId/students/import` | นำเข้ารายชื่อนักเรียนจากไฟล์ CSV / `.xlsx` (multipart ฟิลด์ `file`; `?dryRun=true` = ตรวจ+พรีวิวโดยไม่บันทึก; ตรวจทุกแถวก่อนแบบ all-or-nothing) |
| POST | `/api/classrooms/:classroomId/students` | เพิ่มนักเรียนเข้าห้อง (ปุ่ม "+") |
| DELETE | `/api/classrooms/:classroomId/students/:studentId` | เอานักเรียนออกจากห้อง |
| GET | `/api/students` | รายชื่อนักเรียนทั้งหมดของครู (รองรับ `?q=`) |
| GET | `/api/students/template` | ดาวน์โหลดแม่แบบ CSV สำหรับนำเข้ารายชื่อนักเรียน (`รหัสนักเรียน, ชื่อ-นามสกุล, อีเมล, รหัสผ่าน`) |
| POST | `/api/students` | เพิ่มนักเรียนใหม่ (คืนรหัสผ่านชั่วคราว; แนบ `classroomId` เพื่อเข้าห้องทันที) |
| PATCH/DELETE | `/api/students/:studentId` | แก้ไข (ชื่อ/อีเมล/รหัส/ระงับการใช้งาน) / **เอานักเรียนออกจากทุกห้องของครูคนนี้** (ไม่ลบบัญชี ไม่แตะข้อมูลครูคนอื่น) |
| POST | `/api/students/:studentId/reset-password` | รีเซ็ตรหัสผ่านนักเรียน (คืนรหัสใหม่) |
| GET/POST | `/api/exams` | ข้อสอบ: ดูทั้งหมด (รองรับ `?status=&courseId=`) / สร้างใหม่ (ตั้ง `timeLimitMinutes`, `allowedIpRanges` ได้) |
| GET/PATCH/DELETE | `/api/exams/:examId` | รายละเอียด (รวม submissionStats) / แก้ไข / ลบ (`?force=true` ถ้ามีคนส่งแล้ว) |
| POST | `/api/exams/:examId/publish` \| `/close` | เปิด / ปิดการสอบ |
| GET | `/api/exams/default-cutoffs` | เกณฑ์ตัดเกรดมาตรฐาน A–F (ค่าเริ่มต้นของฟอร์ม) |
| GET | `/api/exams/request-ip` | IP ปัจจุบันของผู้เรียก (ช่วยตั้งค่า `allowedIpRanges`) |
| GET | `/api/exams/questions/import-template` | ดาวน์โหลดแม่แบบ CSV สำหรับนำเข้าข้อคำถาม (`ประเภท, โจทย์, คะแนน, ตัวเลือก A–D, เฉลย, คำตอบอ้างอิง, คำอธิบาย`) |
| POST | `/api/exams/:examId/questions` | เพิ่มข้อคำถาม (ปรนัย/อัตนัย + คะแนน) |
| PATCH/DELETE | `/api/exams/:examId/questions/:questionId` | แก้ไข / ลบข้อคำถาม |
| PUT | `/api/exams/:examId/questions/order` | จัดลำดับข้อคำถาม (ส่ง `items: [{ id, order }]`) |
| POST | `/api/exams/:examId/questions/import` | นำเข้าข้อคำถามจากไฟล์ CSV / `.xlsx` (multipart ฟิลด์ `file`; `?dryRun=true` = ตรวจ+พรีวิวโดยไม่บันทึก; ทำได้เฉพาะ `DRAFT`) |
| GET/PUT | `/api/exams/:examId/cutoffs` | ดู / กำหนดเกณฑ์ตัดเกรด A–F (แทนที่ทั้งชุด) |
| POST | `/api/exams/:examId/assignments` | มอบหมายข้อสอบให้ห้องเรียน (+ ช่วงเวลาเปิด/ปิด) |
| DELETE | `/api/exams/:examId/assignments/:assignmentId` | ยกเลิกการมอบหมาย |
| GET | `/api/grading/exams/:examId/submissions` | รายการส่งข้อสอบของทั้งชุด (รองรับ `?status=`, มี `needsGrading`) |
| GET | `/api/grading/submissions/:submissionId` | รายละเอียดคำตอบทุกข้อ (สำหรับตรวจ) + `ungradedCount` |
| PATCH | `/api/grading/answers/:answerId` | ตรวจอัตนัย: ถูก/ไม่ถูก + หมายเหตุ + ปรับคะแนน |
| POST | `/api/grading/submissions/:submissionId/release` | **"ส่งผลไปให้นักเรียน"** (รายคน) |
| POST | `/api/grading/exams/:examId/release` | ปล่อยผลทั้งชุด (ข้ามคนที่ยังตรวจไม่ครบ) |
| GET | `/api/grading/exams/:examId/stats` | สถิติข้อสอบ: จำนวนรอตรวจ/รอปล่อยผล, คะแนนเฉลี่ย–สูงสุด–ต่ำสุด, การกระจายเกรด, อัตราตอบถูกต่อข้อ |
| GET | `/api/grading/exams/:examId/export` | ส่งออกผลคะแนนทั้งชุดเป็น CSV (รองรับ `?status=`; UTF-8 เปิดใน Excel ได้) |

### นักเรียน (Student) — `/api/my`

| Method | Path | คำอธิบาย |
| :--- | :--- | :--- |
| POST | `/api/classrooms/join` | เข้าห้องเรียนด้วย `joinCode` |
| GET | `/api/my/classrooms` | ห้องเรียนที่ตัวเองอยู่ |
| GET | `/api/my/exams` | ข้อสอบที่ได้รับมอบหมาย + `canStart` + `mySubmission` |
| GET | `/api/my/exams/:examId` | รายละเอียดข้อสอบ (ไม่มีเฉลย/คะแนนรายข้อ) + `serverTime` |
| POST | `/api/my/exams/:examId/submissions` | เริ่มทำข้อสอบ (หรือทำใบเดิมต่อ) |
| GET | `/api/my/submissions/:submissionId` | สถานะการทำข้อสอบของตัวเอง |
| PUT | `/api/my/submissions/:submissionId/answers` | บันทึกคำตอบแบบ bulk |
| POST | `/api/my/submissions/:submissionId/submit` | ส่งข้อสอบ → `SUBMITTED` (รอตรวจ) |
| GET | `/api/my/results` | รายการผลสอบ (ซ่อนคะแนนจนกว่าจะปล่อย; รองรับ `?examId=`) |
| GET | `/api/my/results/:submissionId` | ผลสอบ + เฉลย + หมายเหตุครู (ต้อง `RELEASED`) |

### สถานะของ Submission

`IN_PROGRESS` → `SUBMITTED` (ส่งแล้ว รอตรวจ) → `GRADED` (ตรวจครบ) → `RELEASED` (ปล่อยผลให้นักเรียนแล้ว)

### ตัวอย่างการเรียกใช้งาน (cURL)

**1) ล็อกอินเป็นครู**

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"teacher@demo.local","password":"Teacher123!","role":"TEACHER"}'
```

```json
{
  "user": { "id": "…", "email": "teacher@demo.local", "fullName": "ครูสมชาย ใจดี", "role": "TEACHER", "isActive": true },
  "accessToken": "eyJhbGciOi…",
  "refreshToken": "eyJhbGciOi…",
  "expiresAt": "2026-11-17T10:30:00.000Z"
}
```

**2) นักเรียนเข้าห้องเรียนด้วยรหัส**

```bash
curl -X POST http://localhost:4000/api/classrooms/join \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"joinCode":"MATH41"}'
```

**3) นักเรียนเริ่มทำข้อสอบ → บันทึกคำตอบ → ส่ง**

```bash
# เริ่มทำ (ได้ submission id + expiresAt)
curl -X POST http://localhost:4000/api/my/exams/$EXAM_ID/submissions \
  -H "Authorization: Bearer $STUDENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"displayMode":"PAGINATED"}'

# บันทึกคำตอบแบบ bulk (เรียกซ้ำได้เรื่อย ๆ ระหว่างทำ)
curl -X PUT http://localhost:4000/api/my/submissions/$SUBMISSION_ID/answers \
  -H "Authorization: Bearer $STUDENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"answers":[{"questionId":"…","choiceId":"…"},{"questionId":"…","textAnswer":"x = -3"}]}'

# ส่งข้อสอบ
curl -X POST http://localhost:4000/api/my/submissions/$SUBMISSION_ID/submit \
  -H "Authorization: Bearer $STUDENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"displayMode":"PAGINATED"}'
```

**4) ครูตรวจอัตนัย แล้วปล่อยผล**

```bash
# ตรวจ 1 ข้อ (ถูก/ไม่ถูก + หมายเหตุ + ปรับคะแนนได้)
curl -X PATCH http://localhost:4000/api/grading/answers/$ANSWER_ID \
  -H "Authorization: Bearer $TEACHER_TOKEN" -H "Content-Type: application/json" \
  -d '{"isCorrect":true,"awardedPoints":2,"graderComment":"ถูกต้อง แต่ควรแสดงวิธีทำ"}'

# ปล่อยผลรายคน / ทั้งชุด
curl -X POST http://localhost:4000/api/grading/submissions/$SUBMISSION_ID/release \
  -H "Authorization: Bearer $TEACHER_TOKEN"
curl -X POST http://localhost:4000/api/grading/exams/$EXAM_ID/release \
  -H "Authorization: Bearer $TEACHER_TOKEN"
```

**5) ต่ออายุ / ออกจากระบบ**

```bash
curl -X POST http://localhost:4000/api/auth/refresh -H "Content-Type: application/json" \
  -d '{"refreshToken":"'"$REFRESH_TOKEN"'"}'
curl -X POST http://localhost:4000/api/auth/logout -H "Content-Type: application/json" \
  -d '{"refreshToken":"'"$REFRESH_TOKEN"'"}'
```

---

## ⚠️ รูปแบบ error และรหัสข้อผิดพลาด

ทุก error ใช้รูปแบบเดียวกันหมด:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "ผลสอบยังไม่ถูกปล่อย กรุณารอครูประกาศผล",
    "details": [ { "field": "body.email", "message": "…" } ]
  }
}
```

- `details` จะมีเฉพาะกรณี validation ล้มเหลว (บอก field + เหตุผล)
- error ที่ไม่ใช่ `ApiError` (เช่น หลุดจาก code) จะเป็น `500 INTERNAL_ERROR`
  และใน non-production จะมี `stack` ติดมาด้วยเพื่อช่วยดีบัก

| HTTP | `code` | เกิดเมื่อ |
| :---: | :--- | :--- |
| 400 | `BAD_REQUEST` | validation ล้มเหลว / ข้อมูลไม่ถูกกติกา (เช่น ปรนัยไม่ครบ 2 ตัวเลือก, JSON พัง) |
| 401 | `UNAUTHORIZED` | ไม่มี token / token ผิดหรือหมดอายุ / ใช้ refresh token แทน access token |
| 403 | `FORBIDDEN` | บทบาทไม่ตรง / ไม่ใช่เจ้าของข้อมูล / ผลสอบยังไม่ถูกปล่อย / ข้อสอบยังไม่เปิด |
| 404 | `NOT_FOUND` | ไม่พบข้อมูลที่ระบุ หรือไม่พบ endpoint |
| 409 | `CONFLICT` | ข้อมูลซ้ำ (อีเมล/รหัส/assignment ซ้ำ) หรือสถานะขัดแย้ง (ส่งข้อสอบไปแล้ว, หมดเวลา) |
| 422 | `UNPROCESSABLE_ENTITY` | ข้อมูลถูกต้องแต่ยังประมวลผลไม่ได้ (เช่น ตรวจไม่ครบก่อนปล่อยผล) |
| 429 | `TOO_MANY_REQUESTS` | เรียกถี่เกิน rate limit |
| 500 | `INTERNAL_ERROR` | ข้อผิดพลาดภายในระบบ |

ระบบยัง map error ของ Prisma ให้ด้วย:

| Prisma code | ผลลัพธ์ |
| :--- | :--- |
| `P2002` (unique violation) | `409 CONFLICT` + บอกชื่อ field ที่ซ้ำ |
| `P2025` (record not found) | `404 NOT_FOUND` |
| `P2003` (foreign key violation) | `409 CONFLICT` |

---

## 🚦 Rate Limiting

ใช้ `express-rate-limit` เฉพาะจุดที่เสี่ยง brute-force (ส่ง header `RateLimit-*` มาตรฐาน draft-8)

| ปลายทาง | ขอบเขต | เพดาน |
| :--- | :--- | :--- |
| `POST /api/auth/login` | ต่อ IP | **10 ครั้ง / 15 นาที** |
| `POST /api/auth/teacher/register` และ `/student/register` | ต่อ IP | **20 ครั้ง / ชั่วโมง** |
| `PATCH /api/auth/password` | ต่อ IP | **10 ครั้ง / 15 นาที** |

> เกินเพดานจะได้ `429` พร้อมข้อความไทย ("พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง")

---

## 🔌 Realtime (Socket.IO)

นอกจาก REST API ระบบมีชั้น realtime ให้ frontend ใช้แจ้งเตือนการเปลี่ยนแปลงแบบทันที
(แนบอยู่บนพอร์ตเดียวกัน แยกกันที่ path `/socket.io`) — ยืนยันตัวตนด้วย **access token ตัวเดียวกับ REST**

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', { auth: { token: accessToken } });

socket.on('connect_error', (err) => console.error(err.message)); // เช่น "UNAUTHORIZED: …"
socket.on('connected', (me) => console.log('realtime ready', me)); // { userId, role, room, serverTime }

// ตรวจว่าชั้น realtime ยังทำงาน
socket.emit('ping', (res) => console.log(res)); // { pong: true, serverTime }
```

- server ตรวจ token **ตอน handshake** รับได้ทั้ง `auth.token` และ header `Authorization: Bearer …`
- เมื่อต่อสำเร็จ server จะใส่ socket เข้าห้อง **`user:<userId>`** อัตโนมัติ → ทุกแท็บ/ทุกอุปกรณ์ของคนเดียวกันได้ event พร้อมกัน
- frontend **ไม่ต้อง** join ห้องเอง
- `serveClient: false` — ให้ frontend import `socket.io-client` จาก npm เอง
- token หมดอายุ → ปฏิเสธ; ให้ refresh ผ่าน REST แล้วต่อใหม่

| Event (server → client) | Payload | เกิดเมื่อ | ผู้รับ |
| :--- | :--- | :--- | :--- |
| `connected` | `{ userId, role, room, serverTime }` | เชื่อมต่อสำเร็จ | ผู้ที่เชื่อมต่อ |
| `exam:published` | `{ examId, title, serverTime }` | ครูเปิดสอบ (ครั้งแรก) | นักเรียนในห้องที่ถูกมอบหมาย |
| `submission:submitted` | `{ examId, submissionId, studentId, serverTime }` | นักเรียนส่งข้อสอบ | ครูเจ้าของข้อสอบ |
| `submission:graded` | `{ examId, submissionId, answerId, serverTime }` | ครูตรวจอัตนัยเสร็จ 1 ข้อ | ครูเจ้าของข้อสอบ |
| `result:released` | `{ examId, submissionId?, serverTime }` | ครูกด "ส่งผลไปให้นักเรียน" | นักเรียนเจ้าของผลสอบ |

> event เป็นแค่ **"สะกิด"** — เมื่อได้รับแล้วให้ไปดึงข้อมูลใหม่ผ่าน REST (ไม่ส่ง state ทั้งก้อนผ่าน socket)
>
> 📖 รายละเอียดทั้งหมด (ตัวอย่าง Vue, การสเกลหลาย instance) อยู่ที่ [`docs/REALTIME.md`](docs/REALTIME.md)
> ทดสอบได้ด้วย `npm run test:realtime` (ต้องรันเซิร์ฟเวอร์ค้างไว้ในอีกเทอร์มินัล)

---

## 🧩 โครงสร้างโปรเจกต์

```
src/
  app.js                 # ประกอบ Express app (helmet, cors, routes, error handler)
  server.js              # entrypoint (HTTP + Socket.IO) + graceful shutdown
  config/env.js          # โหลดและ validate env ด้วย zod
  docs/openapi.js        # OpenAPI 3.0 spec (ต้นทางของ Swagger UI)
  realtime/
    index.js             # ตั้ง Socket.IO + auth ตอน handshake + จัดการห้อง
    events.js            # ชื่อ event ทั้งหมด (RealtimeEvent, RealtimeClientEvent, Room)
    emit.js              # ตัวช่วยยิง event (ปลอดภัยเมื่อยังไม่ init io)
  lib/
    prisma.js            # PrismaClient + @prisma/adapter-pg
    access.js            # helper ตรวจสิทธิ์ (ownership / enrollment / ช่วงเวลาสอบ)
    grading.js           # ตรวจปรนัยอัตโนมัติ + คิดคะแนน/เกรด + คิดคะแนนเต็ม
    jwt.js               # ออก/ตรวจ access & refresh token + hash token (sha256)
    password.js          # hash / verify รหัสผ่านด้วย bcryptjs
    errors.js            # ApiError + publicUser()
    serialize.js         # แปลง Prisma Decimal → number ก่อนส่ง JSON
    csv.js               # สร้าง CSV ปลอดภัย (escape + กัน formula injection + BOM)
    questionImport.js    # อ่าน/ตรวจไฟล์ CSV–Excel ที่นำเข้าข้อคำถาม (แยกจาก DB เพื่อเทสต์ง่าย)
    ipAllowlist.js       # ตรวจ IP/CIDR allowlist (IPv4/IPv6) สำหรับจำกัดเครื่องที่เข้าทำข้อสอบ
  middleware/
    auth.js              # authenticate + requireRole/teacherOnly/studentOnly
    validate.js          # ตรวจ params/body/query ด้วย zod
    upload.js            # multer (memory storage) รับไฟล์นำเข้า + แปลง error เป็น ApiError
    error.js             # notFoundHandler + errorHandler (รวม map Prisma error)
    rateLimit.js         # loginLimiter / registerLimiter
  services/              # business logic
    auth.service.js      #  # register/login/refresh/logout + ออก token
    course.service.js
    classroom.service.js #  # ห้องเรียน, enrollment, จัดการนักเรียน, joinCode
    exam.service.js      #  # ข้อสอบ, คำถาม, เกณฑ์ตัดเกรด, assignments, publish
    submission.service.js#  # เริ่มทำ/บันทึกคำตอบ/ส่งข้อสอบ + ตรวจปรนัย
    grading.service.js   #  # ตรวจอัตนัย + ปล่อยผล
    result.service.js    #  # ผลสอบฝั่งนักเรียน (บังคับ release gate)
  routes/                # นิยาม endpoint ตามกลุ่ม
    index.js auth.routes.js course.routes.js classroom.routes.js
    student.routes.js exam.routes.js grading.routes.js my.routes.js
    docs.routes.js       # Swagger UI + openapi.json
  validators/common.js   # schema กลาง (uuid, idParams, booleanQuery, …)
prisma/
  schema.prisma          # โมเดลฐานข้อมูลทั้งหมด
  migrations/            # SQL migration
  seed.js                # ข้อมูลตัวอย่าง
prisma.config.js         # Prisma 7 CLI config (datasource + seed)
scripts/
  realtime-smoke.mjs     # ทดสอบ Socket.IO end-to-end (npm run test:realtime)
  test-db.mjs            # เตรียมฐานข้อมูลเทสต์ (สร้าง + migrate) สำหรับ CI
  ci-check.mjs           # ตรวจเครื่องมือ (Node >= 24.18) ก่อนรัน CI
  ci-test.mjs            # รันเทสต์ + ออกรายงาน JUnit/LCOV สำหรับ CI (npm run test:ci)
tests/
  setup-env.js           # ตั้งค่า env ก่อน import แอป (NODE_ENV=test, ชี้ DB _test)
  helpers/               # ตัวช่วยเทสต์ (db, fixtures, http, csv, api-error)
  unit/                  # unit test (ไม่แตะ DB)
  integration/           # integration test (PostgreSQL จริง + HTTP จริง)
Jenkinsfile              # ไปป์ไลน์ CI (Windows agent)
docs/REALTIME.md         # คู่มือชั้น realtime สำหรับ frontend
diagrams/                # ER Diagram + Flowcharts (Mermaid)
docker-compose.yml       # PostgreSQL สำหรับ dev
.env.example             # ตัวอย่างค่าตั้งต้น (คัดลอกเป็น .env)
```

---

## 🧾 หมายเหตุเฉพาะ Prisma 7

Prisma 7 เปลี่ยนวิธีทำงานหลายอย่างจากเวอร์ชันก่อนหน้า โปรเจกต์นี้ปรับตามแล้ว:

- **Connection string อยู่ใน `prisma.config.js`** (อ่านจาก `DATABASE_URL` ด้วย `env()`) ไม่ได้อยู่ใน `schema.prisma`
  — ในสคีมาจึงมีแค่ `datasource db { provider = "postgresql" }`
- แอปต้องใช้ **driver adapter** (`@prisma/adapter-pg` ใช้ `node-postgres`) ตอนสร้าง `PrismaClient`
  (ดู `src/lib/prisma.js`) จึงต้องมี dependency `pg`
- CLI **ไม่อ่าน `.env` เอง** — โปรเจกต์นี้โหลดผ่าน `import 'dotenv/config'` ใน `prisma.config.js`
- `prisma generate` / `prisma db seed` **ต้องรันเอง** (ไม่ทำงานอัตโนมัติหลัง migrate)
  seed ถูกกำหนดไว้ที่ `prisma.config.js → migrations.seed = 'node prisma/seed.js'`
- ค่า `Decimal` จาก Prisma จะถูกส่งเป็น string ใน JSON — โปรเจกต์แปลงเป็น `number` ให้ก่อนส่งด้วย
  helper ใน `src/lib/serialize.js` (`toNumber`, `serializeTeacherSubmission`, …)

---

## 🛠 คู่มือนักพัฒนา (Development)

### เพิ่ม endpoint ใหม่ (แนวทางที่โปรเจกต์ใช้)

1. เพิ่ม business logic ใน `src/services/*.service.js` (ใช้ helper ใน `lib/access.js` ตรวจสิทธิ์เสมอ)
2. นิยาม route + zod schema ใน `src/routes/*.routes.js` ผ่าน `validate({ params, body, query })`
3. ถ้าเป็นงานที่ frontend ควรรู้ทันที ให้ยิง event ผ่าน `emitToUser` / `emitToUsers` (เพิ่มชื่อ event ที่ `realtime/events.js`)
4. อัปเดต `src/docs/openapi.js` ให้ตรงกับ endpoint จริง

### เกี่ยวกับการเขียน migration

```bash
# ระหว่างพัฒนา (แก้ schema.prisma แล้วสร้าง migration + apply + generate)
npm run migrate

# อยากเริ่ม DB ใหม่ทั้งหมด (ลบข้อมูลเดิม)
npm run reset
```

### เปิด Prisma Studio ดูข้อมูล

```bash
npm run studio
```

### Graceful shutdown

`src/server.js` ดัก `SIGINT` / `SIGTERM` แล้วปิด Socket.IO → HTTP server → Prisma
และบังคับปิดภายใน 10 วินาทีถ้าไม่สำเร็จ

---

## 🧪 การทดสอบ

โปรเจกต์มีชุดเทสต์ครบทั้ง **unit test** และ **integration test** เขียนด้วย [`node:test`](https://nodejs.org/api/test.html)
ที่มากับ Node 24 — **ไม่ต้องเพิ่ม dependency** (ไม่มี vitest/jest/supertest)

| ชุด | ที่อยู่ | ลักษณะ |
| :--- | :--- | :--- |
| Unit | `tests/unit/**` | ฟังก์ชันล้วน/middleware — ไม่แตะฐานข้อมูล (เร็ว) |
| Integration | `tests/integration/**` | ใช้ **PostgreSQL จริง** (ฐานข้อมูลเทสต์แยก) + ยิง HTTP จริงผ่าน Express |

```bash
# 1) เตรียมฐานข้อมูลเทสต์ (ครั้งแรก/หลังมี migration ใหม่)
npm run test:db

# 2) รันเทสต์
npm test                 # ทั้งหมด
npm run test:unit        # เฉพาะ unit
npm run test:integration # เฉพาะ integration
npm run test:coverage    # พร้อมรายงาน coverage
```

**หลักการของชุดเทสต์**

- ใช้ฐานข้อมูลแยกชื่อลงท้าย **`_test`** (ค่าเริ่มต้น `wa_education_test`) เพื่อไม่แตะข้อมูลพัฒนา/production
  - ตั้งที่อยู่เองได้ด้วย `TEST_DATABASE_URL` และสคริปต์จะ **ปฏิเสธ** ชื่อ DB ที่ไม่ลงท้าย `_test`
- ตั้งค่า environment ก่อน import แอปผ่าน `tests/setup-env.js` (`NODE_ENV=test`, `BCRYPT_ROUNDS=4`, ปิด rate limit)
- ล้างข้อมูลด้วย `TRUNCATE` ก่อนทุกเคส → จึงรันแบบ **ทีละไฟล์** (`--test-concurrency=1`) เพื่อไม่ให้ชนกัน
- เทสต์ยิง HTTP จริงผ่าน `fetch` ของ Node (ไม่ใช้ supertest) และตรวจสัญญา route/สถานะ/รูปแบบ error

> `npm run test:realtime` เป็น **smoke test** ชั้น Socket.IO แยกต่างหาก ต้องมีเซิร์ฟเวอร์รันค้างไว้:

```bash
# terminal 1
npm run dev

# terminal 2 (ต้อง seed แล้ว)
npm run test:realtime
```

สคริปต์ [`scripts/realtime-smoke.mjs`](scripts/realtime-smoke.mjs) จะตรวจ:

1. handshake ปฏิเสธเมื่อไม่มี token / token ปลอม
2. ต่อสำเร็จแล้วได้ `connected` + ถูกใส่ห้อง `user:<id>` ถูกต้อง
3. `ping` / `pong` ทำงาน
4. REST ที่เปลี่ยนสถานะยิง event ให้ถูกคนครบทั้ง 4 event
   (`exam:published`, `submission:submitted`, `submission:graded`, `result:released`)
5. ตรวจว่า `release` แล้วสถานะเป็น `RELEASED` และมีเกรด

> ข้อมูลที่สร้างระหว่างเทสต์จะถูกลบในตอนจบ เพื่อคืน DB กลับสู่สภาพหลัง seed
> รันแบบชี้ไปที่เซิร์ฟเวอร์อื่นได้ด้วย `BASE_URL=http://host:4000 npm run test:realtime`

---

## 🔁 CI ด้วย Jenkins

ไปป์ไลน์อยู่ใน [`Jenkinsfile`](Jenkinsfile) ที่รากโปรเจกต์ รันบน **agent Windows** (ใช้ `bat`)
ลำดับสเต็ป: ตรวจเครื่องมือ → `npm ci` + `npm run generate` → `npm run test:db` → `npm run test:ci`
แล้วเก็บผลเป็น JUnit XML + LCOV

**สิ่งที่ต้องเตรียมบนเครื่อง agent**

| ต้องมี | รายละเอียด |
| :--- | :--- |
| Node.js | **≥ 24.18.0** (ตาม `package.json` → `engines`) — สเต็ปแรกจะพังเร็วถ้าเวอร์ชันไม่ถึง |
| npm | มาพร้อม Node |
| PostgreSQL | เข้าถึงได้จาก agent (ค่าเริ่มต้น `localhost:5432`) |
| git | สำหรับ checkout |

**ตั้งค่าที่ตัว job**

- ใน Jenkins สร้าง job ชนิด **Pipeline** แล้วชี้ *Pipeline script from SCM* ไปที่ repo นี้ (สคริปต์ = `Jenkinsfile`)
- กำหนด **label ของ agent** ใน `Jenkinsfile` (`agent { label 'windows' }`) ให้ตรงกับ label ของเครื่อง Windows
  ที่ต่อกับ Jenkins — ถ้าไม่แน่ใจให้ใช้ `agent any` เมื่อมีแต่ agent Windows
- ตั้งพารามิเตอร์ **`TEST_DATABASE_URL`** ให้ชี้ฐานข้อมูลที่ชื่อลงท้าย `_test`
  (ค่าเริ่มต้น `postgresql://postgres:postgres@localhost:5432/wa_education_test?schema=public`)
  แนะนำให้เก็บรหัสผ่านเป็น **Jenkins Credentials** แล้วอ้างใน `environment` ของ job

**ผลลัพธ์หลัง build**

- แท็บ **Tests** — ผลทดสอบรายเคสจาก `reports/junit.xml`
- แท็บ **Coverage** — coverage จาก `coverage/lcov.info` (ต้องติดตั้ง **Coverage plugin**;
  ถ้ายังไม่มีไปป์ไลน์จะข้ามการเผยแพร่ coverage อย่างเงียบ ๆ ไม่ทำให้ build แดง)
- **Artifacts** — ดาวน์โหลด `reports/junit.xml` และ `coverage/lcov.info` ได้

> เทสต์ใช้ฐานข้อมูลเทสต์ร่วมกันและ `TRUNCATE` ทุกเคส — `Jenkinsfile` จึงปิดการรันซ้อนด้วย
> `disableConcurrentBuilds()` ไม่ให้สองบิลด์แย่งกันล้างข้อมูล

---

## 🩺 Troubleshooting

| อาการ | สาเหตุที่เป็นไปได้ | วิธีแก้ |
| :--- | :--- | :--- |
| แอปไม่สตาร์ต พิมพ์ `[env] invalid environment configuration` | ค่าใน `.env` ขาด/ผิด (เช่น secret สั้นกว่า 16 ตัวอักษร, `DATABASE_URL` ว่าง) | ตรวจ `.env` เทียบกับตารางตัวแปรด้านบน |
| `Can't reach database server` / Prisma เชื่อมต่อไม่ได้ | ยังไม่เปิด PostgreSQL หรือพอร์ตไม่ตรง | `docker compose up -d` แล้วเช็คว่า `DATABASE_URL` ใช้พอร์ต 5433 (Docker) หรือ 5432 (ในเครื่อง) |
| ต่อ DB ไม่ได้ทั้งที่ Docker ขึ้นแล้ว | healthcheck ยังไม่ผ่าน | รอสักครู่ (`pg_isready`) หรือดู log `docker compose logs db` |
| `@prisma/client did not initialize yet` | ยังไม่ generate client | `npm run generate` |
| ล็อกอินแล้วขึ้น `403` "บัญชีนี้เป็นบทบาท …" | ส่ง `role` ไม่ตรงกับบัญชีจริง | ส่ง `role` ให้ตรง (ครู/นักเรียน) |
| `429` ตอนล็อกอิน | เกิน rate limit (ค่าเริ่มต้น 10 ครั้ง/15 นาที ต่อ IP) | รอตาม `Retry-After` ใน response แล้วลองใหม่ · ตอนพัฒนาให้ตั้ง `LOGIN_RATE_LIMIT_MAX` สูง ๆ หรือ `RATE_LIMIT_DISABLED=true` ใน `.env` แล้วรีสตาร์ต (ตัวนับเป็น in-memory → รีสตาร์ตเซิร์ฟเวอร์ก็ล้าง) |
| ยิง API แล้วได้ `401` | ไม่ได้แนบ header หรือ token หมดอายุ | แนบ `Authorization: Bearer <access token>` หรือเรียก `/api/auth/refresh` |
| `/api/docs` เปิดไม่ได้ | `DOCS_ENABLED=false` หรือรันด้วย `NODE_ENV=production` | ตั้ง `DOCS_ENABLED=true` ถ้าจำเป็น |
| Socket.IO `connect_error: UNAUTHORIZED` | ไม่ได้ส่ง access token หรือ token หมดอายุ | ส่ง `auth: { token }` และ refresh token ให้ใหม่ก่อน |
| Frontend โดน CORS block | origin ไม่อยู่ใน allow-list | เพิ่ม origin ใน `CORS_ORIGIN` (คั่นหลายค่าด้วย `,`) แล้วรีสตาร์ต |
| `npm run seed` ไม่ทำอะไร | seed ข้ามเมื่อมีข้อมูล demo อยู่แล้ว | ใช้ `npm run reset` ถ้าต้องการเริ่มใหม่ |
| เทสต์พัง `ต้องลงท้าย "_test"` | `TEST_DATABASE_URL` ชี้ฐานข้อมูลที่ไม่ใช่ `_test` | ตั้งชื่อ DB ลงท้าย `_test` (เช่น `wa_education_test`) — เป็นการกันพลาดลบข้อมูลจริง |
| เทสต์ค้าง/ข้อมูลเพี้ยนเป็นระยะ | รันเทสต์ซ้อนกันบน DB เดียว (TRUNCATE ชนกัน) | รันทีละชุด (`--test-concurrency=1` ให้มาแล้ว) และปิด concurrent build ใน Jenkins |
| Jenkins ค้างที่ "waiting for next available executor" | `agent { label ... }` ไม่ตรงกับ label ของเครื่อง Windows | แก้ label ให้ตรง หรือเปลี่ยนเป็น `agent any` |
| Jenkins พังตั้งแต่สเต็ปแรก | Node บน agent เก่ากว่า 24.18 | อัปเดต Node (สคริปต์ `scripts/ci-check.mjs` จะบอกเวอร์ชันที่ต้องใช้) |

---

## 🔒 ความปลอดภัย (Security Notes)

- **รหัสผ่าน** เก็บเป็น bcrypt hash (`BCRYPT_ROUNDS` ปรับได้) — ไม่มีทางอ่านคืนเป็น plaintext
- **Refresh token** เก็บแบบ sha256 hash เท่านั้น และ **rotate ทุกครั้ง** ที่ต่ออายุ → token เก่าใช้ซ้ำไม่ได้
- **ไม่รั่วข้อมูลภายใน**: `publicUser()` ตัด `passwordHash` ออกก่อนส่งกลับทุกครั้ง
- **Anti-leak**: ตัด `isCorrect`, `explanation`, `referenceText`, `points` ออกจาก payload ฝั่งนักเรียน
  และบังคับ **release gate** ก่อนโชว์คะแนน/เฉลย/หมายเหตุ
- **helmet** ตั้ง header ความปลอดภัยให้ทุก response, ปิด `x-powered-by`
- **CORS** เป็น allow-list จาก `CORS_ORIGIN` (ใช้ทั้ง REST และ Socket.IO)
- **Rate limit** ที่ login/register กัน brute-force (production ตรึงค่าจริงไว้ในโค้ด — โหมด dev/test ปรับเพดานหรือปิดได้ด้วย `LOGIN_RATE_LIMIT_MAX` / `REGISTER_RATE_LIMIT_MAX` / `RATE_LIMIT_DISABLED`)
- **Ownership check** ทุก endpoint ของครู/นักเรียน — ไม่มีทางเข้าถึงข้อมูลข้ามคน
- ใน production จะตั้ง `trust proxy` (สำหรับรันหลัง reverse proxy/load balancer) และ **ปิด Swagger UI ให้อัตโนมัติ**

> ⚠️ ก่อน deploy จริง: เปลี่ยน `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` เป็นค่าสุ่มยาว
> (`openssl rand -base64 48`), ตั้ง `NODE_ENV=production`, และอย่าเปิด `DOCS_ENABLED=true` บนอินเทอร์เน็ต

---

## 🚧 ข้อจำกัดที่รู้อยู่ / แนวทางต่อยอด

- **นักเรียนทำข้อสอบได้ 1 ครั้งต่อชุด** (unique `examId + studentId`) — ถ้าต้องการเก็บประวัติหลายครั้งต้องแก้สคีมา
- ยังไม่มี endpoint ให้ **แก้ไข/ลบ refresh token หลายอุปกรณ์** หรือ revoke ทั้งหมดพร้อมกัน
- ยังไม่มี **pagination** ในรายการส่วนใหญ่ (มี helper `paginationQuery` เตรียมไว้ใน `validators/common.js` แล้ว)
- การปล่อยผลทั้งชุดยังเป็น loop ต่อใบ (ถ้าข้อมูลเยอะมากอาจพิจารณา batch)
- Realtime แบบ multi-instance ต้องเพิ่ม adapter กลาง เช่น `@socket.io/redis-adapter`
  (ห้อง `user:<id>` จะไม่ข้าม process กันเอง)
- **มีชุดเทสต์ unit + integration แล้ว** (ดูหัวข้อ [การทดสอบ](#-การทดสอบ)) — ยังไม่มี E2E ระดับเบราว์เซอร์
  (การทดสอบ UI ทำแยกฝั่ง frontend) และยังไม่มี quality gate บังคับ coverage ขั้นต่ำใน CI
- **นำเข้าไฟล์** รองรับเฉพาะ `.csv` และ `.xlsx` (ยังไม่รองรับ `.xls` แบบเก่า) และสูงสุด 5 MB / 500 แถวต่อครั้ง
- **นำเข้ารายชื่อนักเรียน** ใช้ `POST /api/classrooms/:classroomId/students/import` (multipart ฟิลด์ `file`) — ตรวจทุกแถวก่อนแบบ all-or-nothing; คนที่มีบัญชีอยู่แล้วจะถูกผูกเข้าห้องให้
- ยังไม่มี **คลังข้อคำถาม (Question Bank)** แยกจากชุดข้อสอบ (สคีมาผูก `Question` เข้ากับ `Exam` เสมอ)
- **IP restriction** ตรวจเฉพาะตอน "เข้าทำ" (ดึงข้อสอบ/เริ่มทำ) ไม่ได้ตรวจทุกคำขอ และอ้าง `req.ip` ตาม `trust proxy` — ถ้ารันหลัง reverse proxy ต้องตั้ง `trust proxy` ให้ถูก (production ตั้งไว้แล้ว)

---

## 📐 เอกสารออกแบบ (Diagrams)

โฟลเดอร์ [`diagrams/`](diagrams/README.md) มีเอกสารออกแบบที่เขียนด้วย Mermaid (แสดงผลบน GitHub ได้ทันที)

- [`ER_DIAGRAM.md`](diagrams/ER_DIAGRAM.md) — แผนผังฐานข้อมูล + Data Dictionary
- [`FLOWCHART.md`](diagrams/FLOWCHART.md) — ผังกระบวนการทำงานทุกส่วน
  (Auth, Exam Authoring, Exam Taking, Auto/Manual Grading, Result Release)

---

## 📄 License

MIT
