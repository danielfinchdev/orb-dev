// The body of the God mode terminal's read-only tab: the output of the task running in the project, taken from the
// task's session items. There is no shell behind it and nothing can be typed.
import { useEffect, useState } from 'react';
import { call } from '@/lib/store.js';
import { useLiveTasks } from '@/components/live-tasks.jsx';
import { taskOutputLines } from '@/lib/task-output.js';
import { useT } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';

export function TaskOutput({ task }) {
  const t = useT();
  const live = useLiveTasks().find((x) => x.id === task?.id);
  const [text, setText] = useState('');
  useEffect(() => {
    if (!live?.sessionId) { setText(''); return undefined; }
    let alive = true;
    call('sessions.items', { id: live.sessionId, limit: 300 }).then((r) => alive && setText(taskOutputLines(r ?? []))).catch(quiet);
    return () => { alive = false; };
  }, [live?.sessionId, live?.steps, live?.last]);
  if (!task) return <span className="text-muted-foreground">{t('terminal.taskNone')}</span>;
  return <>{text || <span className="text-muted-foreground">{t('terminal.taskWaiting')}</span>}</>;
}
