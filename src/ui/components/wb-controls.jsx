// The PC Pizarra's own controls around the Excalidraw canvas: the floating tool bar (in the approved order, driven by
// Excalidraw's public setActiveTool) and the general «Nota para Orbe» of the whole canvas. Excalidraw's own tool bar is
// hidden with CSS (app.css, .wb-pc) and keeps working through its keyboard shortcuts, which this bar mirrors.
import { MousePointer2, Hand, Square, Diamond, Circle, ArrowRight, Minus, Pencil, Type, Image as ImageIcon, Eraser, StickyNote } from 'lucide-react';
import { Textarea } from '@/components/ui/basic.jsx';
import { BubbleTip, Popover, PopoverTrigger, PopoverContent } from '@/components/ui/overlay.jsx';
import { IconButton } from '@/components/ui/primitives.jsx';
import { Button } from '@/components/ui/button.jsx';
import { useT } from '@/lib/i18n.js';

export const NOTE_MAX = 2000;

// [Excalidraw tool type, icon, shortcut]; null is a separator. Excalidraw's «frame», «web» and «laser» tools are in the
// canvas menu (⋯), not here.
export const TOOLS = [
  ['selection', MousePointer2, 'V'], ['hand', Hand, 'H'], null,
  ['rectangle', Square, 'R'], ['diamond', Diamond, 'D'], ['ellipse', Circle, 'O'], ['arrow', ArrowRight, 'A'], ['line', Minus, 'L'],
  ['freedraw', Pencil, 'P'], ['text', Type, 'T'], ['image', ImageIcon, '9'], null,
  ['eraser', Eraser, 'E']
];

function ToolButton({ tool: [type, Icon, key], active, pick }) {
  const t = useT();
  return (
    <BubbleTip title={`${t(`wb.tool.${type}`)} · ${key}`}>
      <IconButton label={t(`wb.tool.${type}`)} active={active} onClick={() => pick(type)} data-testid={`whiteboard-tool-${type}`}
        className="data-[active=true]:bg-primary-soft data-[active=true]:text-primary-text"><Icon /></IconButton>
    </BubbleTip>
  );
}

export function WbToolbar({ api, tool }) {
  const t = useT();
  const pick = (type) => api.current?.setActiveTool({ type });
  return (
    <div role="toolbar" aria-label={t('wb.tools')} data-testid="whiteboard-tools"
      className="bg-background border-border absolute top-3.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-card border p-1 shadow-(--shadow)">
      {TOOLS.map((x, i) => (x ? <ToolButton key={x[0]} tool={x} active={tool === x[0]} pick={pick} /> : <span key={`sep${i}`} aria-hidden="true" className="bg-border mx-1 h-5 w-px" />))}
    </div>
  );
}

// The general note about the whole canvas: saved when the user stops typing (the status badge turns to «Guardada»).
export function CanvasNote({ value, onChange, assistant }) {
  const t = useT();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" data-testid="whiteboard-canvas-note" aria-label={t('wb.canvasNote', { assistant })}>
          <StickyNote className={value.trim() ? 'text-primary-text' : undefined} />{t('wb.canvasNote', { assistant })}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80" data-testid="whiteboard-canvas-note-pop">
        <div className="grid gap-2">
          <p className="text-muted-foreground text-caption">{t('wb.canvasNote.hint', { assistant })}</p>
          <Textarea value={value} maxLength={NOTE_MAX} rows={5} autoFocus placeholder={t('wb.canvasNote.ph')} onChange={(e) => onChange(e.target.value)}
            aria-label={t('wb.canvasNote', { assistant })} data-testid="whiteboard-canvas-note-text" className="min-h-28 resize-y" />
          <span className="text-faint-foreground text-right text-micro">{t('wb.canvasNote.count', { n: value.length, max: NOTE_MAX })}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
