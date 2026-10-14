// 2.7: the empty chat's greeting changes each time (texts in src/core/locales/*/greet.mjs). What matters comes first: a task
// waiting for approval always; other news (tasks working, left halfway, finished yesterday, the project in use) most
// times; otherwise one for the time of day, one for coming back, or now and then a playful one (never in Profesional).
// Never the same phrase twice in a row.

const TIME = (h, day) => [
  ...(h >= 6 && h < 13 ? ['greet.morning'] : h >= 13 && h < 21 ? ['greet.afternoon'] : ['greet.night']),
  ...(h >= 6 && h < 8 ? ['greet.early'] : []),
  ...(h >= 1 && h < 5 ? ['greet.late'] : []),
  ...(h >= 6 && h < 12 ? ['greet.coffee'] : []),
  ...(h >= 21 ? ['greet.lastHour'] : []),
  ...(day === 5 ? ['greet.friday'] : day === 6 ? ['greet.saturday'] : day === 0 ? ['greet.sunday'] : [])
];
const BACK = ['greet.again', 'greet.otherTime', 'greet.missed', 'greet.welcome', 'greet.onTime', 'greet.lookWho', 'chat.helloUser'];
const FUN = ['greet.reporting', 'greet.online','greet.rested', 'greet.bits', 'greet.build', 'greet.prod', 'greet.permission', 'greet.circuits'];
const SUBS = ['chat.intro', 'greet.sub.1', 'greet.sub.2', 'greet.sub.3', 'greet.sub.4', 'greet.sub.5'];

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const count = (key, n) => ({ key: `${key}.${n === 1 ? 'one' : 'many'}`, n });

// { tasks, project, first, serious, now, last (the previous key), random } → { key, params }; the caller adds user and name.
export function pickGreeting({ tasks = [], project = null, first = false, serious = false, now = new Date(), last = null, random = Math.random } = {}) {
  const pick = (list) => { const pool = list.length > 1 ? list.filter((x) => (x.key ?? x) !== last) : list; return pool[Math.floor(random() * pool.length)]; };
  const words = (list) => list.map((key) => ({ key }));
  if (first) return pick([{ key: 'greet.first1' }, { key: 'greet.first2' }]);
  const by = (s) => tasks.filter((t) => t.status === s).length;
  const approvals = by('awaiting_approval');
  if (approvals) return count('greet.approvals', approvals);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const finished = tasks.filter((t) => t.status === 'done' && t.updated_at && dayKey(new Date(t.updated_at)) === dayKey(yesterday)).length;
  const news = [
    ...(by('running') ? [count('greet.running', by('running'))] : []),
    ...(by('limited') + by('failed') ? [count('greet.halfway', by('limited') + by('failed'))] : []),
    ...(finished ? [count('greet.yesterday', finished)] : []),
    ...(project ? [{ key: 'greet.project', project }] : []),
    ...(!tasks.some((t) => ['queued', 'running', 'awaiting_approval', 'limited', 'blocked'].includes(t.status)) && tasks.length ? [{ key: 'greet.calm' }] : [])
  ];
  const roll = random();
  if (news.length && roll < 0.55) return pick(news);
  // 3.2.1: never «the agents are rested» while they are working.
  const working = tasks.some((t) => ['queued', 'running'].includes(t.status));
  if (!serious && roll > 0.8) return pick(words(FUN.filter((k) => !(working && k === 'greet.rested'))));
  return pick([...words(TIME(now.getHours(), now.getDay())), ...words(BACK)]);
}

// 3.2.1: the suggestions under the greeting. With a project already chosen, nothing about creating one; without one,
// nothing about «the project».
const SUGGESTIONS = ['chat.suggestion1', 'chat.suggestion2', 'chat.suggestion4'];
const PROJECT_SUGGESTIONS = ['chat.suggestionProject1', 'chat.suggestion3', 'chat.suggestion2', 'chat.suggestionProject2'];
export const suggestionsFor = (project) => (project ? PROJECT_SUGGESTIONS : SUGGESTIONS);

export function pickSubtitle({ last = null, random = Math.random } = {}) {
  const pool = SUBS.filter((k) => k !== last);
  return pool[Math.floor(random() * pool.length)];
}
