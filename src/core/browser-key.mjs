// The key one conversation uses to drive its page of the agents' browser: derived from the app's secret for exactly that
// agent, conversation and task. An agent only ever gets its own key, so it cannot drive (or pose as) another
// conversation's page. The app (main process) recomputes it to check each connection.
// 3.6: person (someone other than the owner): whose browser profile the page uses; the key signs it too, so an agent
// cannot open its pages in another person's profile.
import crypto from 'node:crypto';

export const browserKey = (secret, { agent, session, task = '', person = '' }) =>
  crypto.createHmac('sha256', String(secret)).update(`${agent}\n${session}\n${task}${person ? `\n${person}` : ''}`).digest('hex');
