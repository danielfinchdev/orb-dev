// ---- a long press (touch) or a right click (mouse) opens the menu; the click that follows a long press is swallowed.
import { useRef } from 'react';

export function usePress(onMenu, ms = 480) {
  const timer = useRef(null); const start = useRef(null); const fired = useRef(false);
  const clear = () => { clearTimeout(timer.current); timer.current = null; };
  return {
    onPointerDown: (e) => {
      fired.current = false;
      if (e.pointerType === 'mouse') return;
      start.current = [e.clientX, e.clientY];
      timer.current = setTimeout(() => { fired.current = true; navigator.vibrate?.(8); onMenu(); }, ms);
    },
    onPointerMove: (e) => { if (timer.current && start.current && Math.hypot(e.clientX - start.current[0], e.clientY - start.current[1]) > 8) clear(); },
    onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear,
    onContextMenu: (e) => { e.preventDefault(); if (!fired.current && !timer.current) onMenu(); },
    onClickCapture: (e) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; } }
  };
}
