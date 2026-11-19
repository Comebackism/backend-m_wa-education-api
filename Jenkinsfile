/**
 * Jenkinsfile — CI ของ backend WA Education API (รันบน agent Windows)
 *
 * ลำดับงาน
 *   1. ตรวจเครื่องมือ (Node >= 24.18 ตาม engines)   → scripts/ci-check.mjs
 *   2. npm ci + prisma generate                      → เตรียม dependency
 *   3. เตรียมฐานข้อมูลเทสต์ (migrate)                → scripts/test-db.mjs
 *   4. รัน unit + integration test พร้อม coverage    → scripts/ci-test.mjs
 *   5. เก็บผล: JUnit XML + lcov coverage
 *
 * หมายเหตุ
 *   - ต้องมี PostgreSQL ที่ agent เข้าถึงได้ และตั้ง TEST_DATABASE_URL ให้ชี้ฐานข้อมูลที่ชื่อลงท้าย "_test"
 *   - เทสต์ใช้ฐานข้อมูลร่วมกัน (TRUNCATE) จึงปิดการรันซ้อนด้วย disableConcurrentBuilds()
 *   - agent ต้องเป็น Windows เพราะสเต็ปใช้ `bat` — ถ้า label ของ agent ไม่ใช่ค่าที่รองรับ
 *     ให้แก้ `agent { label ... }` ด้านล่าง (หรือใช้ `agent any` ถ้ามีแต่ agent Windows)
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

  parameters {
    string(
      name: 'TEST_DATABASE_URL',
      defaultValue: 'postgresql://postgres:postgres@localhost:5432/wa_education_test?schema=public',
      description: 'connection string ของฐานข้อมูลเทสต์ (ชื่อ DB ต้องลงท้าย "_test" เท่านั้น)',
    )
  }

  environment {
    // บังคับโหมดเทสต์ให้ทุกสคริปต์ที่รันในไปป์ไลน์นี้
    NODE_ENV = 'test'
    TEST_DATABASE_URL = "${params.TEST_DATABASE_URL}"
    // ลด noise ของ npm ใน log
    NPM_CONFIG_AUDIT = 'false'
    NPM_CONFIG_FUND = 'false'
  }

  stages {
    stage('ตรวจสอบเครื่องมือ') {
      steps {
        bat 'node scripts/ci-check.mjs'
        bat 'git rev-parse --short HEAD'
      }
    }

    stage('ติดตั้ง dependencies') {
      steps {
        bat 'npm ci'
        // Prisma v7 ไม่ generate client ให้อัตโนมัติหลังติดตั้ง
        bat 'npm run generate'
      }
    }

    stage('เตรียมฐานข้อมูลเทสต์') {
      steps {
        bat 'npm run test:db'
      }
    }

    stage('รันเทสต์ + coverage') {
      steps {
        bat 'npm run test:ci'
      }
    }
  }

  post {
    always {
      // ผลทดสอบรายเคส (ต้องมี JUnit plugin — มาพร้อม Jenkins อยู่แล้ว)
      junit allowEmptyResults: true, testResults: 'reports/junit.xml'

      // เผยแพร่ coverage ถ้าติดตั้ง Coverage plugin (parser LCOV) ไว้
      // ถ้ายังไม่มี จะข้ามอย่างเงียบ ๆ ไม่ทำให้ build แดง
      script {
        try {
          recordCoverage tools: [[parser: 'LCOV', pattern: 'coverage/lcov.info']]
        } catch (err) {
          echo "ข้ามการเผยแพร่ coverage (ยังไม่ได้ติดตั้ง Coverage plugin): ${err.message}"
        }
      }

      // เก็บไฟล์ผลลัพธ์ไว้ให้ดาวน์โหลดจากหน้า build
      archiveArtifacts artifacts: 'reports/junit.xml,coverage/lcov.info', allowEmptyArchive: true
    }

    success {
      echo 'ผ่านทุกขั้นตอน: เทสต์และ coverage เรียบร้อย'
    }

    failure {
      echo 'ไม่ผ่าน: ดู stage ที่แดงและ log ของสเต็ปนั้น (ผลทดสอบอยู่ใน reports/junit.xml)'
    }

    cleanup {
      // ล้าง workspace กัน node_modules ค้าง/ปนกันข้ามบิลด์
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
