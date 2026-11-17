# 🔄 System Flowcharts (ผังการทำงานของระบบ)
### ระบบสอบออนไลน์ (Education / Exam System)

เอกสารนี้รวบรวม Flowchart และ Sequence Diagram ที่แสดงขั้นตอนการทำงานทั้งหมดของระบบ ตั้งแต่การยืนยันตัวตน, การจัดการห้องเรียน, การสร้างข้อสอบ, การทำข้อสอบ, การตรวจข้อสอบ (Auto + Manual), และการส่งผลให้นักเรียนดูเฉลยแบบไม่รั่ว

---

## 1. ภาพรวมการทำงานทั้งระบบ (End-to-End System Flowchart)

```mermaid
flowchart TD
    Start([เริ่มต้นเข้าสู่ระบบ]) --> AuthGate{เลือกบทบาทผู้ใช้}

    %% ครู
    AuthGate -->|ครู / Teacher| T_Login["เข้าสู่ระบบครู (Teacher Portal)"]
    T_Login --> T_ManageClass["จัดการห้องเรียน / เพิ่มนักเรียนเข้าห้อง"]
    T_ManageClass --> T_CreateExam["สร้างชุดข้อสอบ & เฉลย & เกณฑ์ตัดเกรด"]
    T_CreateExam --> T_Publish["มอบหมายข้อสอบให้ห้องเรียน & เผยแพร่ (PUBLISHED)"]

    %% นักเรียน
    AuthGate -->|นักเรียน / Student| S_Login["เข้าสู่ระบบนักเรียน (Student Portal)"]
    S_Login --> S_JoinClass["เข้าห้องเรียน (ผ่านรหัสหรือครูเพิ่มให้)"]
    S_JoinClass --> S_ViewExams["ดูรายการข้อสอบที่เปิดให้ทำ"]

    %% การเชื่อมระหว่างครูและนักเรียน
    T_Publish -.-> S_ViewExams
    S_ViewExams --> S_TakeExam["นักเรียนเริ่มทำข้อสอบ (เลือกโหมดแสดงผล)"]
    S_TakeExam --> S_Submit["กดส่งข้อสอบ (สถานะ: ส่งแล้ว รอตรวจ)"]

    %% การตรวจข้อสอบ
    S_Submit --> AutoGrade["ระบบตรวจข้อสอบปรนัยทันที (Auto-grade MCQ)"]
    AutoGrade --> WaitTeacher["รอครูตรวจข้อสอบอัตนัย"]
    WaitTeacher --> T_ManualGrade["ครูเปิดตรวจคำตอบสั้น/ยาว<br/>(ให้คะแนน + ใส่หมายเหตุ ผิด/ถูกเพราะอะไร)"]
    T_ManualGrade --> CalcTotal["ระบบคำนวณคะแนนรวม & ตัดเกรดตามเกณฑ์"]
    CalcTotal --> T_ReleaseBtn{"ครูกดปุ่ม<br/>'ส่งผลไปให้นักเรียน'?"}

    %% การปล่อยผล
    T_ReleaseBtn -- ยังไม่กด --> StatusGraded["สถานะ: ตรวจแล้ว (GRADED)<br/>นักเรียนยังไม่เห็นคะแนน/เฉลย"]
    T_ReleaseBtn -- กดแล้ว --> StatusReleased["สถานะ: ปล่อยผลแล้ว (RELEASED)<br/>บันทึกเวลา released_at"]

    StatusReleased -.-> S_ViewResults["นักเรียนเข้าดูคะแนน เกรด เฉลย<br/>และหมายเหตุรายข้อของครู (ไม่รั่ว)"]
    S_ViewResults --> End([เสร็จสิ้นกระบวนการ])
```

---

## 2. ขั้นตอนการทำงานของฝั่งครู (Teacher Workflow)

```mermaid
flowchart TD
    subgraph M1["1. จัดการห้องเรียน & นักเรียน"]
        T1["เข้าสู่ระบบครู"] --> T2["สร้างรายวิชา (Course) & ห้องเรียน (Classroom)"]
        T2 --> T3["ได้รหัส Join Code ประจำห้อง"]
        T3 --> T4["จัดการรายชื่อนักเรียน<br/>(กดปุ่ม '+' เพิ่มนักเรียน / แก้ไข / ลบ)"]
    end

    subgraph M2["2. สร้างและจัดการชุดข้อสอบ (Exam Authoring)"]
        T4 --> T5["กดสร้างชุดข้อสอบใหม่ (Create Exam)"]
        T5 --> T6["กำหนดชื่อ รายละเอียด เวลาสอบ (นาที) และโหมดแสดงผลเริ่มต้น"]
        T6 --> T7["เพิ่มข้อสอบรายข้อ พร้อมกำหนดคะแนน:"]
        
        T7 --> Q_MCQ["1. ปรนัย (Multiple Choice):<br/>- เพิ่มตัวเลือก A, B, C, D<br/>- ติ๊กเลือกข้อถูก (isCorrect)<br/>- ใส่คำอธิบายเฉลย"]
        T7 --> Q_SHORT["2. คำตอบสั้น (Short Answer):<br/>- ใส่โจทย์<br/>- กำหนด Reference Text (เฉลยแนวทางตอบ)"]
        T7 --> Q_LONG["3. เรียงความ (Long Answer / Essay):<br/>- ใส่โจทย์<br/>- กำหนด Reference Text & เกณฑ์ประเมิน"]

        Q_MCQ --> T8["กำหนดเกณฑ์ตัดเกรด (Grade Cutoffs)<br/>เช่น A: >=80%, B: >=70%, C: >=60%, F: <50%"]
        Q_SHORT --> T8
        Q_LONG --> T8

        T8 --> T9["ผูกข้อสอบกับห้องเรียน (Exam Assignment)<br/>กำหนดช่วงเวลาเปิดสอบ (available_from - available_to)"]
        T9 --> T10["กดเผยแพร่ข้อสอบ (สถานะ: PUBLISHED)"]
    end

    subgraph M3["3. ตรวจข้อสอบและส่งผล (Grading & Release)"]
        T10 --> T11["นักเรียนส่งข้อสอบเข้ามา"]
        T11 --> T12["ครูเปิดหน้ารายการผู้ส่งสอบ (Submissions List)"]
        T12 --> T13["ระบบแสดงคะแนนปรนัยที่ตรวจออโต้แล้ว"]
        T13 --> T14["ครูตรวจข้อสอบอัตนัย (คำตอบสั้น/ยาว):<br/>1. เทียบคำตอบนักเรียนกับ Reference Text<br/>2. ตัดสิน ถูก / ผิด / ถูกบางส่วน<br/>3. กรอกคะแนนที่ได้ (awarded_points)<br/>4. พิมพ์หมายเหตุ (grader_comment) ระบุเหตุผล"]
        T14 --> T15["กดยืนยันบันทึกผลตรวจ (ระบบคำนวณเกรดอัตโนมัติ)"]
        T15 --> T16["กดปุ่ม 'ส่งผลไปให้นักเรียน' (Release Results)"]
    end
```

---

## 3. ขั้นตอนการทำข้อสอบของนักเรียน (Student Exam Taking Flow)

```mermaid
flowchart TD
    S1["นักเรียนเข้าสู่ระบบ (Student Portal)"] --> S2["เลือกห้องเรียน & เลือกชุดข้อสอบที่เปิดอยู่"]
    S2 --> S3["กดปุ่ม 'เริ่มทำข้อสอบ' (Start Exam)"]
    
    subgraph AntiLeak1["🛡️ ระบบป้องกันเฉลยรั่ว (Backend API Protection)"]
        S3 --> API_Filter["Backend ส่งเฉพาะโจทย์และตัวเลือก<br/>❌ กรองฟิลด์ isCorrect, referenceText, explanation ทิ้งทั้งหมด"]
    end

    API_Filter --> S4["หน้าทำข้อสอบ (Student Exam UI)"]
    S4 --> S5{"เลือกรูปแบบการแสดงผล (Display Mode)"}
    
    S5 -->|รวมในหน้าเดียว| ModeSingle["โหมดรวมหน้าเดียว (Single Page)<br/>แสดงข้อสอบทั้งหมดเรียงลงมา หรือ 10 ข้อ/หน้า"]
    S5 -->|แบ่งหน้า| ModePaginated["โหมดแบ่งหน้า (Paginated)<br/>แสดงทีละข้อ พร้อมปุ่ม 'ถัดไป / ย้อนกลับ'"]

    ModeSingle --> S6["ตอบข้อสอบ: ปรนัย (คลิกเลือก), อัตนัย (พิมพ์ข้อความ)"]
    ModePaginated --> S6

    S6 --> S7{"หมดเวลา หรือ กดยืนยันส่งข้อสอบ?"}
    S7 -- ยังไม่ส่ง --> S6
    S7 -- ยืนยันส่ง --> S8["ส่งกระดาษคำตอบเข้าสู่ระบบ (POST /api/submissions/:id/submit)"]
    
    S8 --> S9["สถานะเปลี่ยนเป็น 'ส่งแล้ว รอตรวจ' (SUBMITTED)"]
    S9 --> S10["แสดงหน้าสรุปการส่งข้อสอบ<br/>🔒 ซ่อนคะแนนและเฉลยทั้งหมดจนกว่าครูจะปล่อยผล"]
```

---

## 4. กลไกการตรวจข้อสอบและตัดเกรด (Grading & Cutoff Engine)

```mermaid
flowchart TD
    SubReceived["ได้รับคำตอบจากการส่งข้อสอบ (Submission Submitted)"] --> LoopQ["วนลูปตรวจคำตอบทีละข้อ"]

    subgraph AutoGrading["⚙️ ระบบตรวจอัตโนมัติ (Auto-Grading)"]
        LoopQ --> CheckType{"ประเภทข้อสอบ?"}
        CheckType -->|MULTIPLE_CHOICE| MCQCheck{"choice_id ที่นักเรียนเลือก<br/>ตรงกับตัวเลือกที่ is_correct = true ไหม?"}
        
        MCQCheck -- ตรงกัน (ถูกต้อง) --> MCQ_Correct["- is_correct = true<br/>- awarded_points = question.points<br/>- auto_graded = true"]
        MCQCheck -- ไม่ตรงกัน (ผิด) --> MCQ_Wrong["- is_correct = false<br/>- awarded_points = 0<br/>- auto_graded = true"]
    end

    subgraph ManualGrading["👨‍🏫 ครูตรวจข้อสอบอัตนัย (Manual Grading)"]
        CheckType -->|SHORT_ANSWER or LONG_ANSWER| SubjectiveWait["- is_correct = null<br/>- awarded_points = null<br/>- auto_graded = false<br/>รอครูเข้ามาประเมิน"]
        
        SubjectiveWait --> TeacherAction["ครูเปิดหน้าประเมินข้อสอบ"]
        TeacherAction --> T_Review["ครูอ่านคำตอบนักเรียน เทียบกับเฉลยแนวทาง (reference_text)"]
        T_Review --> T_Score["ครูกรอกคะแนนที่ได้ (0 ถึงเต็ม)"]
        T_Review --> T_Decision["ครูเลือกผลประเมิน (ถูก / ผิด)"]
        T_Review --> T_Comment["ครูพิมพ์หมายเหตุ (grader_comment)<br/>'ถูกเพราะอะไร / ผิดตรงจุดไหน'"]
    end

    MCQ_Correct --> SumCheck
    MCQ_Wrong --> SumCheck
    T_Score --> SumCheck

    subgraph ScoreCalculation["📊 คำนวณคะแนนและตัดเกรด"]
        SumCheck{"ตรวจครบทุกข้อหรือยัง?"}
        SumCheck -- ยังไม่ครบ --> LoopQ
        SumCheck -- ครบทุกข้อแล้ว --> CalcTotals["คำนวณผลรวมคะแนน:<br/>- auto_score = ผลรวมคะแนนปรนัย<br/>- manual_score = ผลรวมคะแนนอัตนัย<br/>- total_score = auto_score + manual_score<br/>- percent = (total_score / exam.total_points) * 100"]
        
        CalcTotals --> CutoffMatch["เทียบ percent กับ grade_cutoffs ของข้อสอบ<br/>ค้นหาเกรดที่มี min_percent สูงสุดที่เข้าเกณฑ์"]
        CutoffMatch --> SaveGrade["บันทึก grade (เช่น A, B+, B, ...) ลง submission<br/>สถานะเปลี่ยนเป็น GRADED"]
    end
```

---

## 5. กระบวนการดูผลคะแนนแบบปลอดภัย ไม่รั่ว (Result Release & Security Flow)

```mermaid
sequenceDiagram
    autonumber
    actor S as นักเรียน (Student)
    participant FE as Vue Frontend
    participant API as Express Backend
    participant DB as PostgreSQL DB
    actor T as ครู (Teacher)

    Note over S, DB: 1. ช่วงสอบและหลังส่งข้อสอบทันที (Status: SUBMITTED)
    S->>FE: ส่งกระดาษคำตอบ
    FE->>API: POST /api/submissions/:id/submit
    API->>DB: บันทึกคำตอบ + Auto-grade ปรนัย + ตั้งสถานะ SUBMITTED
    API-->>FE: ส่งสถานะ "ส่งแล้ว รอตรวจ" (ไม่ส่งคะแนน ไม่ส่งเฉลย)
    FE-->>S: แสดงข้อความ "ส่งข้อสอบเรียบร้อยแล้ว รอผลตรวจจากครู"

    opt กรณีนักเรียนแอบยิง API ขอดูผลก่อนเวลา
        S->>API: GET /api/submissions/:id/results
        API->>DB: ตรวจสอบ status ของ submission
        DB-->>API: status == "SUBMITTED" หรือ "GRADED" (ยังไม่ใช่ RELEASED)
        API-->>S: 403 Forbidden ("ผลสอบยังไม่ได้รับการเผยแพร่")
    end

    Note over T, DB: 2. ช่วงครูตรวจและกดปล่อยผล
    T->>API: POST /api/submissions/:id/grade (ตรวจอัตนัย + ใส่หมายเหตุ)
    API->>DB: บันทึกคะแนนและคำอธิบายรายข้อ
    T->>API: POST /api/exams/:examId/release-results (กดปุ่ม "ส่งผลไปให้นักเรียน")
    API->>DB: UPDATE submissions SET status = 'RELEASED', released_at = NOW()
    API-->>T: 200 OK ("ส่งผลสอบให้นักเรียนเรียบร้อยแล้ว")

    Note over S, DB: 3. ช่วงนักเรียนดูผลหลังปล่อยผลแล้ว (Status: RELEASED)
    S->>FE: กดดูผลคะแนนสอบ
    FE->>API: GET /api/submissions/:id/results
    API->>DB: ตรวจสอบ status
    DB-->>API: status == "RELEASED"
    API->>DB: ดึงคะแนนรวม, เกรด, เฉลยคำตอบ, คะแนนรายข้อ, และหมายเหตุของครู
    API-->>FE: Payload ฉบับสมบูรณ์ (คะแนน, เฉลย, หมายเหตุครู)
    FE-->>S: แสดงหน้าสรุปผล: คะแนนรวม, เกรด, ข้อที่ถูก/ผิด, และคำแนะนำของครู
```
