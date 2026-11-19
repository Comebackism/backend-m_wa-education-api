/**
 * Jenkinsfile — CI ของ backend WA Education API (รันบน agent Windows)
 *
 * ลำดับงาน
 *   1. ตรวจเครื่องมือ (Node >= .nvmrc)                    → scripts/ci-check.mjs
 *   2. npm ci + prisma generate                           → เตรียม dependency
 *   3. ตรวจ schema Prisma (validate + migration drift)     → กันลืมทำ migration
 *   4. lint + format check                                 → ESLint + Prettier
 *   5. unit test (เร็ว ไม่ใช้ DB)                          → ด่านแรกก่อนแตะ DB
 *   6. เตรียมฐานข้อมูลเทสต์ (migrate deploy)               → scripts/test-db.mjs
 *   7. รัน integration test + coverage                     → scripts/ci-test.mjs
 *   8. ตรวจช่องโหว่ dependency (ไม่บล็อก build)            → npm audit
 *
 * สิ่งที่ต้องเตรียมบน Jenkins
 *   - Credential ชนิด Secret text ชื่อ "wa-education-test-db-url"
 *     เก็บ connection string ของฐานข้อมูลที่ชื่อลงท้าย "_test"
 *     (ใช้ทั้ง TEST_DATABASE_URL และ DATABASE_URL ให้ Prisma CLI)
 *   - Agent ต้องเป็น Windows (สเต็ปใช้ `bat`) — ปรับ `agent { label ... }` ให้ตรงเครื่อง
 *
 * หมายเหตุ
 *   - เทสต์ใช้ฐานข้อมูลร่วมกัน (TRUNCATE) จึงปิดการรันซ้อนด้วย disableConcurrentBuilds()
 *   - trigger เป็นแบบกดเอง (ไม่มี webhook/poll) — กรณีต้องการอัตโนมัติให้เพิ่ม pollSCM หรือ webhook
 */
pipeline {
  agent { label 'windows' }

  options {
    timestamps()
    // เทสต์ TRUNCATE ฐานข้อมูลเทสต์ร่วมกัน — ห้ามรันซ้อนกัน
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '20'))
    timeout(time: 30, unit: 'MINUTES')
  }

  environment {
    // บังคับโหมดเทสต์ให้ทุกสคริปต์ที่รันในไปป์ไลน์นี้
    NODE_ENV = 'test'
    // ดึงจาก Jenkins Credentials (ถูก mask ใน log) — ไม่ต้องมีไฟล์ .env บน agent
    TEST_DATABASE_URL = credentials('wa-education-test-db-url')
    DATABASE_URL = credentials('wa-education-test-db-url')
    // cache ของ npm เก็บนอก workspace เพื่อไม่ให้ deleteDir() ลบทิ้งทุกบิลด์
    NPM_CONFIG_CACHE = 'D:\\jenkins-cache\\npm'
    // ลด noise ของ npm ใน log
    NPM_CONFIG_AUDIT = 'false'
    NPM_CONFIG_FUND = 'false'
  }

  stages {
    stage('ตรวจสอบเครื่องมือ') {
      steps {
        // chcp 65001 = ให้ process ลูกส่งออกเป็น UTF-8
        // (ถ้าอยากให้ log ไทยอ่านได้ครบ ต้องรีสตาร์ต Jenkins ด้วย -Dfile.encoding=UTF-8 — ดู README)
        bat 'chcp 65001 >nul & node scripts/ci-check.mjs'
        bat 'chcp 65001 >nul & git rev-parse --short HEAD'
      }
    }

    stage('ติดตั้ง dependencies') {
      steps {
        bat 'chcp 65001 >nul & npm ci'
        // Prisma v7 ไม่ generate client ให้อัตโนมัติหลังติดตั้ง
        bat 'chcp 65001 >nul & npm run generate'
      }
    }

    stage('ตรวจ schema Prisma') {
      steps {
        bat 'chcp 65001 >nul & node node_modules/prisma/build/index.js validate'
      }
    }

    stage('Lint + format') {
      steps {
        bat 'chcp 65001 >nul & npm run lint'
        bat 'chcp 65001 >nul & npm run format:check'
      }
    }

    stage('Unit test') {
      steps {
        // unit ไม่แตะ DB — พังเร็วโดยไม่ต้องรอ stage ฐานข้อมูล
        bat 'chcp 65001 >nul & npm run test:unit'
      }
    }

    stage('เตรียมฐานข้อมูลเทสต์') {
      steps {
        bat 'chcp 65001 >nul & npm run test:db'
      }
    }

    stage('ตรวจ migration drift') {
      steps {
        // ผ่าน = สถานะ DB (DATABASE_URL) หลัง migrate deploy ตรงกับ prisma/schema.prisma
        // exit 2 = schema ถูกแก้แต่ยังไม่มี migration → ให้ build แดง
        bat 'chcp 65001 >nul & node node_modules/prisma/build/index.js migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code'
      }
    }

    stage('Integration test + coverage') {
      steps {
        bat 'chcp 65001 >nul & npm run test:ci'
      }
    }

    stage('ตรวจช่องโหว่ dependencies') {
      steps {
        // รายงานไว้ก่อน — ยังไม่บล็อก build (เปลี่ยนเป็น fail ได้เมื่อพร้อม)
        bat 'chcp 65001 >nul & npm audit --omit=dev --audit-level=high || exit /b 0'
      }
    }
  }

  post {
    always {
      // ผลทดสอบรายเคส (ต้องมี JUnit plugin — มาพร้อม Jenkins อยู่แล้ว)
      junit allowEmptyResults: true, testResults: 'reports/junit.xml'

      // เผยแพร่ coverage + quality gate (Coverage plugin, parser LCOV)
      // LINE < 95% = build แดง
      script {
        try {
          // LINE < 95% = build แดง (branch coverage 85% บังคับใน scripts/ci-test.mjs
          // เพราะ Coverage plugin อ่านค่า branch จาก LCOV ของ Node ไม่ได้)
          recordCoverage(
            tools: [[parser: 'LCOV', pattern: 'coverage/lcov.info']],
            qualityGates: [
              [threshold: 95.0, metric: 'LINE', unstable: false],
            ],
          )
        } catch (err) {
          echo "ข้ามการเผยแพร่ coverage (ยังไม่ได้ติดตั้ง Coverage plugin): ${err.message}"
        }
      }

      // เก็บไฟล์ผลลัพธ์ทั้งโฟลเดอร์ไว้ให้ดาวน์โหลดจากหน้า build
      archiveArtifacts artifacts: 'reports/**,coverage/**', allowEmptyArchive: true
    }

    success {
      echo 'ผ่านทุกขั้นตอน: lint, เทสต์, coverage และ schema เรียบร้อย'
    }

    failure {
      echo 'ไม่ผ่าน: ดู stage ที่แดงและ log ของสเต็ปนั้น (ผลทดสอบอยู่ใน reports/junit.xml)'
    }

    cleanup {
      // ล้าง workspace กัน node_modules ค้าง/ปนกันข้ามบิลด์ (npm cache อยู่นอก workspace จึงไม่หาย)
      script {
        try {
          deleteDir()
        } catch (err) {
          echo "ล้าง workspace ไม่สำเร็จ: ${err.message}"
        }
      }
    }
  }
}
