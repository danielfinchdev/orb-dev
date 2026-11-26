// The optional «why are you uninstalling» note: the text is turned into a prefilled new-issue page on GitHub. Orb sends nothing:
// the user opens the page in the browser and submits it there. Only what the user typed and the Orb version leave the app.
import { AUTHOR } from './product.mjs';

export const SURVEY_MAX = 280;
export const SURVEY_TITLE = 'Uninstall feedback';

// One line, trimmed, at most SURVEY_MAX characters (counted in code points so an emoji is never cut in half).
export function cleanSurvey(text) {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  return [...one].slice(0, SURVEY_MAX).join('').trim();
}

// What the issue will say, shown to the user exactly like this before anything opens.
export function surveyIssue(text, version) {
  const note = cleanSurvey(text);
  if (!note) return null;
  const v = String(version ?? '').replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 32);
  return { title: SURVEY_TITLE, note, version: v, body: v ? `${note}\n\nOrb ${v}` : note };
}

// Always https://github.com/<repo>/issues/new, nothing else; null when there is nothing to send.
export function surveyUrl(text, version, repo = AUTHOR.repo) {
  const issue = surveyIssue(text, version);
  if (!issue) return null;
  return `https://github.com/${repo}/issues/new?title=${encodeURIComponent(issue.title)}&body=${encodeURIComponent(issue.body)}`;
}
