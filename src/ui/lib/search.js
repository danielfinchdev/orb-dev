// The search of the chats' list and of Ctrl+K: from two letters, the messages of the chats (inbox.search and, for the
// direct conversations, conversations.search) and, 3.8.2, what the tasks say (tasks.search).
import { useEffect, useState } from 'react';
import { call } from '@/lib/store.js';

export function useSearch(query) {
  const [found, setFound] = useState(null);
  useEffect(() => {
    const q = query.trim(); if (q.length < 2) { setFound(null); return undefined; }
    let alive = true;
    const id = setTimeout(async () => {
      const [inbox, direct, tasks] = await Promise.all([call('inbox.search', { zone: 'orb', q }).catch(() => null), call('conversations.search', { q }).catch(() => null), call('tasks.search', { q }).catch(() => null)]);
      if (alive) setFound({ messages: inbox?.messages ?? [], conversations: new Set([...(inbox?.items ?? []).map((x) => x.id), ...(direct?.conversations ?? [])]), sessions: new Set(direct?.sessions ?? []), tasks: tasks ?? [] });
    }, 220);
    return () => { alive = false; clearTimeout(id); };
  }, [query]);
  return found;
}
