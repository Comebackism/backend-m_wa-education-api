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
];
