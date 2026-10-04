// The key one conversation uses to drive its page of the agents' browser: derived from the app's secret for exactly that
// agent, conversation and task. An agent only ever gets its own key, so it cannot drive (or pose as) another
// conversation's page. The app (main process) recomputes it to check each connection.
import crypto from 'node:crypto';

export const browserKey = (secret, { agent, session, task = '' }) =>
  crypto.createHmac('sha256', String(secret)).update(`${agent}\n${session}\n${task}`).digest('hex');
