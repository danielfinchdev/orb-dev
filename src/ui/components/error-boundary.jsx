// 3.8: a screen that fails while drawing never leaves the app blank or reopening on it at every start: the saved route
// is forgotten at once and a calm card offers the way back (main.jsx wraps each screen, and the whole window).
import { Component } from 'react';
import { Home } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { Robot } from './robot.jsx';
import { t } from '@/lib/i18n.js';

export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) {
    try { localStorage.removeItem('orb.route'); } catch { /* storage unavailable */ }
    console.error(error, info?.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const home = () => { this.setState({ failed: false }); this.props.onHome?.(); };
    return (
      <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-8 text-center" role="alert" data-testid="screen-failed">
        <div className="grid max-w-sm justify-items-center gap-3">
          <Robot size={84} mood="worried" />
          <h1 className="text-lg">{t('app.crashTitle')}</h1>
          <p className="text-muted-foreground text-sm">{t('app.crashBody')}</p>
          <Button onClick={home} data-testid="screen-failed-home"><Home />{t('app.crashHome')}</Button>
        </div>
      </div>
    );
  }
}
