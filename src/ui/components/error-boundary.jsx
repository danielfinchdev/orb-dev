// 3.8: a screen that fails while drawing never leaves the app blank or reopening on it at every start: the saved route
// is forgotten at once and a calm card offers the way back (main.jsx wraps each screen, and the whole window).
// 3.8.1 (H4a): a screen whose file could not be loaded (a phone's browser gets the files from the PC over the network)
// is not broken: «Sin conexión» and «Reintentar», which fetches it again (lib/lazy.js); the route is kept. After two
// retries that fail, «Reintentar» reloads the page. A window over the screen (Ajustes, the games, the tour) passes
// `onFail` instead: it closes and says why, and draws again when it is opened again (`resetKey` changes).
import { Component, Fragment } from 'react';
import { Home, RotateCw, WifiOff } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { Robot } from './robot.jsx';
import { t } from '@/lib/i18n.js';
import { isLoadError, retryLoads } from '@/lib/lazy.js';

export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false, offline: false, tries: 0, round: 0 }; }
  static getDerivedStateFromError(error) { return { failed: true, offline: isLoadError(error) }; }
  componentDidCatch(error, info) {
    const offline = isLoadError(error);
    if (!offline) { try { localStorage.removeItem('orb.route'); } catch { /* storage unavailable */ } }
    console.error(error, info?.componentStack);
    this.props.onFail?.({ offline });
  }
  componentDidUpdate(prev) {
    if (this.state.failed && this.props.resetKey && prev.resetKey !== this.props.resetKey) this.retry();
  }
  retry = () => {
    if (!this.props.onFail && this.state.offline && this.state.tries >= 2) { location.reload(); return; }
    retryLoads();
    this.setState((s) => ({ failed: false, offline: false, tries: s.offline ? s.tries + 1 : 0, round: s.round + 1 }));
  };
  render() {
    if (!this.state.failed) return <Fragment key={this.state.round}>{this.props.children}</Fragment>;
    if (this.props.onFail) return null;
    const home = () => { this.setState({ failed: false }); this.props.onHome?.(); };
    if (this.state.offline) return (
      <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-8 text-center" role="alert" data-testid="screen-offline">
        <div className="grid max-w-sm justify-items-center gap-3">
          <WifiOff className="text-muted-foreground size-10" aria-hidden="true" />
          <h1 className="text-lg">{t('app.loadOfflineTitle')}</h1>
          <p className="text-muted-foreground text-sm">{t('app.loadOfflineBody')}</p>
          <Button onClick={this.retry} data-testid="screen-offline-retry"><RotateCw />{t('app.offlineRetry')}</Button>
        </div>
      </div>
    );
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
