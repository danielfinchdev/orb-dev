// The app icon: the same robot the interface uses (its head), on the periwinkle backdrop of the setup screen.
import '@/app.css';
import { createRoot } from 'react-dom/client';
import { Robot } from '@/components/robot.jsx';

createRoot(document.getElementById('r')).render(
  <div id="icon" className="brand-sky grid place-items-center" style={{ width: 512, height: 512, borderRadius: 116, boxShadow: 'inset 0 -10px 30px rgba(40,50,140,.25)' }}>
    <Robot size={430} head still />
  </div>
);
window.done = true;
