# 26. Languages

Part of [How Orb works](../ARCHITECTURE.md).

- The app is in Spain Spanish and English (Settings → Language, applied immediately).
- Files:
  - base: `src/shared/i18n.mjs` (`translate`, `createT`, `localeOf`);
  - dictionaries: one file per area in `src/shared/locales/es/` and `en/` (chat, session, tasks, agents,
    settings, setup, msg…), gathered by `es.mjs` and `en.mjs`;
  - interface: `src/ui/lib/i18n.js` (`useT()` and `useLocale()` in components, `t()` and `currentLocale()` outside them);
  - engine: `tr()` from `src/platform/context.mjs` (chat notices, errors and guard reasons in the chosen language).
- **Adding a string:** write `t('screen.key')` in the component and add the key to **both** dictionaries. A test checks
  they match.
- What goes to the agents (briefs, assistant instructions) is not translated: the reply language is set by
  `config.language`.
