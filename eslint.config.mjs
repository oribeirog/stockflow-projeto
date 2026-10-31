import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
      '.cache/**',
      '.angular/**',
      '.local-data/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
  },
  { files: ['**/*.html'], extends: [...angular.configs.templateRecommended] },
);
