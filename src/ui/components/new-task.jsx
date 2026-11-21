import { notifyOk } from '@/lib/notify.js';
import { form } from '@/components/dialogs.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { Field, Input, Textarea } from '@/components/ui/basic.jsx';
import { Select } from '@/components/ui/overlay.jsx';
import { call } from '@/lib/store.js';

const reviewers = async () => (await call('agents.status')).filter((a) => a.enabled && a.installed);

// «Nueva tarea» (Tareas, and «Encargar una tarea» in a chat's Ficha): the same call Orbe makes when it creates a task
// (tasks.create); the guard then decides about approval. origin: the chat it is made from, kept only as a label.
export async function askNewTask(tr, projects, current, origin = null) {
  const agents = await reviewers();
  return form(tr('tasks.new.title'), {
    description: tr('tasks.new.desc'), wide: true,
    initial: { project: current ?? projects[0] ?? '', title: '', description: '', agent: 'any' },
    body: (v, set) => (<>
      <Field label={tr('tasks.new.project')}><Select className="w-full" value={v.project} onValueChange={(project) => set({ project })} options={projects.map((name) => ({ value: name, label: name, icon: <ProjectIcon name={name} small /> }))} /></Field>
      <Field label={tr('tasks.titleField')}><Input value={v.title} onChange={(e) => set({ title: e.target.value })} /></Field>
      <Field label={tr('tasks.new.description')}><Textarea rows={5} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <Field label={tr('tasks.agent')}><Select className="w-full" value={v.agent} onValueChange={(agent) => set({ agent })} options={[{ value: 'any', label: tr('tasks.reassign.any') }, ...agents.map((a) => ({ value: a.id, label: a.label }))]} /></Field>
    </>),
    ok: tr('tasks.new.ok'),
    onOk: async (v) => { const made = await call('tasks.create', { project: v.project, title: v.title.trim(), description: v.description.trim(), agent: v.agent, ...(origin != null ? { origin_session: origin } : {}) }); notifyOk(tr('tasks.new.done')); return made; }
  });
}
