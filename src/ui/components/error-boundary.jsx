// a screen that fails while drawing never leaves the app blank or reopening on it at every start: the saved route
// is forgotten at once and a calm card offers the way back (main.jsx wraps each screen, and the whole window).
// a screen whose file could not be loaded (a phone's browser gets the files from the PC over the network)
// is not broken: «Sin conexión» and «Reintentar», which fetches it again (lib/lazy.js); the route is kept. After two
// retries that fail, «Reintentar» reloads the page. A window over the screen (Ajustes, the games, the tour) passes
// `onFail` instead: it closes and says why, and draws again when it is opened again (`resetKey` changes).
import { Component, Fragment } from 'react';
import { Home, RotateCw, TriangleAlert, WifiOff } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { StartNotice, startText, startHint } from './start-card.jsx';
import { t } from '@/lib/i18n.js';
import { bridge } from '@/lib/store.js';
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
    if (this.state.offline) return <OfflineCard onRetry={this.retry} />;
    return <CrashCard onHome={home} />;
  }
}

// The two cards, also drawn alone by the start-up preview of the e2e tour (main.jsx).
export function OfflineCard({ onRetry }) {
  return (
    <StartNotice testid="screen-offline" role="alert" cover={false} icon={WifiOff} title={t('app.loadOfflineTitle')}
      footer={<Button onClick={onRetry} data-testid="screen-offline-retry"><RotateCw />{t('app.offlineRetry')}</Button>}>
      <p className={startText}>{t('app.loadOfflineBody')}</p>
      <p className={startText}>{t('app.loadOfflineNote')}</p>
    </StartNotice>
  );
}
export function CrashCard({ onHome }) {
  return (
    <StartNotice testid="screen-failed" role="alert" cover={false} icon={TriangleAlert} title={t('app.crashTitle')}
      footer={<Button onClick={onHome} data-testid="screen-failed-home"><Home />{t('app.crashHome')}</Button>}>
      <p className={startText}>{t('app.crashBody')}</p>
      {/* a screen failed but the engine is alive: only here is it true that Orb keeps working underneath */}
      {bridge.desktop ? <p className={startHint}>{t('app.errorHint')}</p> : null}
    </StartNotice>
  );
}
