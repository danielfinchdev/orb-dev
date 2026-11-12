// Flat config. The one rule that matters here: notifications go through lib/notify.js, never straight to the toast
// library. The react-hooks stub only lets the existing "eslint-disable" comments resolve without that plugin.
const reactHooksStub = { rules: { 'exhaustive-deps': { meta: { schema: [] }, create: () => ({}) } } };

export default [
  {
    files: ['src/ui/**/*.{js,jsx,mjs}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooksStub },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'sonner', message: 'Use notify() from lib/notify.js: it is the only way to show a notice.' }] }]
    }
  },
  { files: ['src/ui/lib/notify.js'], rules: { 'no-restricted-imports': 'off' } }
];
