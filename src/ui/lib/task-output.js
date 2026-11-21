// What a running task has done so far, as plain lines for a read-only view (God mode's «Salida de la tarea»): the same
// session items the task's conversation shows, nothing is run or typed.
const textOf = (b) => (typeof b === 'string' ? b : b && typeof b === 'object' ? String(b.text ?? b.message ?? '') : '');

export function taskOutputLines(items = []) {
  const lines = [];
  for (const it of items) {
    const b = it.body;
    if (it.kind === 'tool') lines.push(`$ ${b?.name ?? ''}${b?.input ? `: ${typeof b.input === 'string' ? b.input : JSON.stringify(b.input)}` : ''}`);
    else if (it.kind === 'file') lines.push(`± ${b?.path ?? ''}`);
    else if (it.role === 'error') lines.push(`! ${textOf(b)}`);
    else if (it.kind === 'text' && it.role === 'assistant') lines.push(textOf(b));
  }
  return lines.filter((l) => l.trim()).join('\n');
}
