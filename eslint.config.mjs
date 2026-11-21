// Flat config. The one rule that matters here: notifications go through lib/notify.js, never straight to the toast
// library. The react-hooks stub only lets the existing "eslint-disable" comments resolve without that plugin.
const reactHooksStub = { rules: { 'exhaustive-deps': { meta: { schema: [] }, create: () => ({}) } } };
// The names the WebView gives every script. no-undef with them catches a helper used without its import (a call that
// would only fail when the user reaches it).
const browser = Object.fromEntries('window document clearTimeout setTimeout localStorage sessionStorage navigator requestAnimationFrame location setInterval clearInterval console performance cancelAnimationFrame URL MutationObserver innerWidth innerHeight history ResizeObserver Blob IntersectionObserver Event matchMedia getComputedStyle atob btoa CustomEvent self URLSearchParams Notification Image Element AbortController requestIdleCallback cancelIdleCallback removeEventListener addEventListener Worker TextDecoder TextEncoder OfflineAudioContext AudioContext KeyboardEvent FileReader CSS Audio fetch crypto structuredClone queueMicrotask globalThis'.split(' ').map((n) => [n, 'readonly']));

export default [
  {
    files: ['src/ui/**/*.{js,jsx,mjs}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: browser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooksStub },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-undef': 'error',
      // a `const` read in its own scope before its line (a hook's dependency list above the state it names) throws as
      // soon as the component renders; uses from inner functions are fine and are not reported
      'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
      'no-restricted-imports': ['error', { paths: [{ name: 'sonner', message: 'Use notify() from lib/notify.js: it is the only way to show a notice.' }] }]
    }
  },
  { files: ['src/ui/lib/notify.js'], rules: { 'no-restricted-imports': 'off' } }
];
