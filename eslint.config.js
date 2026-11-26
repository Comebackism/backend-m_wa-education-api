import js from '@eslint/js';
import globals from 'globals';

/**
 * ESLint (flat config) สำหรับ backend — Node ESM
 *
 * เป้าหมาย: จับ bug จริง (ตัวแปรที่ไม่ได้ประกาศ/ไม่ได้ใช้, การเปรียบเทียบพลาด)
 * โดยไม่สร้าง noise จากสไตล์ (จัดรูปแบบยกให้ Prettier)
 */
export default [
  {
    ignores: ['node_modules/**', 'src/generated/**', 'coverage/**', 'reports/**', 'diagrams/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.mjs', 'scripts/**/*.js'],
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Playwright บังคับให้พารามิเตอร์ตัวแรกของ fixture เป็น object destructuring เสมอ
    // แม้ fixture นั้นไม่ต้องพึ่ง fixture อื่น (เช่น dbReset/dbTeardown ที่เป็น auto)
    files: ['tests/api/**/*.js'],
    rules: {
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
    },
  },
];
