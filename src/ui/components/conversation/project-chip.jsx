// «Sin proyecto ⌄» on the row over the box of the chat with the assistant (mock-up 02): the project the conversation works in, as
// a menu of Orb's own. A conversation that started changes its project; a new one sets the one Orb works in.
import { Check, ChevronDown, Folder, FolderOpen, FolderPlus, FolderX } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, BubbleTip } from '@/components/ui/overlay.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { GithubIcon } from '@/components/agent-icon.jsx';
import { createProjectFlow, linkFolderFlow, cloneRepoFlow } from '@/components/project-actions.jsx';
import { act, call, useStore } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';

export function ProjectChip({ conversation = null }) {
  const t = useT();
  const projects = useStore((s) => s.projects);
  const working = useStore((s) => s.app?.activeProject);
  const conv = useStore((s) => (conversation == null ? null : s.conversations?.find((c) => c.id === conversation) ?? null));
  const active = conversation == null ? working : conv?.project ? projects.find((p) => p.name === conv.project) ?? { name: conv.project } : null;
  const setActive = (name) => act(conversation == null ? call('projects.setActive', { name }) : call('conversations.update', { id: conversation, project: name }));
  return (
    <DropdownMenu>
      <BubbleTip title={t('comp.projects.pick')} side="top">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" className="text-muted-foreground max-w-56 font-normal" data-testid="project-picker">
            {active ? <ProjectIcon name={active.name} className="size-3.5" /> : <Folder className="size-3.5" />}
            <span className="truncate">{active ? active.name : t('nav.loose')}</span><ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
      </BubbleTip>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <DropdownMenuLabel>{t('comp.projects.inFolder')}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setActive('')} data-testid="project-none">
          <FolderX /><span className="grid flex-1 leading-tight"><span className="truncate">{t('nav.loose')}</span><span className="text-muted-foreground text-xs">{t('comp.projects.noneHint')}</span></span>{!active ? <Check className="text-primary-text!" /> : null}
        </DropdownMenuItem>
        {projects.length ? projects.map((p) => (
          <DropdownMenuItem key={p.name} onSelect={() => setActive(p.name)}>
            <ProjectIcon name={p.name} className="size-3.5" /><span className="flex-1 truncate">{p.name}</span>{active?.name === p.name ? <Check className="text-primary-text!" /> : null}
          </DropdownMenuItem>
        )) : <div className="text-muted-foreground px-2 py-1.5 text-xs">{t('comp.projects.none')}</div>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={async () => { const p = await createProjectFlow(); if (p) setActive(p.name); }}><FolderPlus />{t('comp.projects.newTitle')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={async () => { const p = await linkFolderFlow(); if (p) setActive(p.name); }}><FolderOpen />{t('comp.projects.linkMenu')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={async () => { const p = await cloneRepoFlow(); if (p) setActive(p.name); }}><GithubIcon />{t('comp.projects.cloneMenu')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
