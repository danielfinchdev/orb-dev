// 3.8.1 (H4a): a component that shows a date is drawn again at midnight and when the time zone changes (lib/clock.js),
// even when it is memoised.
import { useSyncExternalStore } from 'react';
import { clockKey, onClock } from './clock.js';

export const useDay = () => useSyncExternalStore(onClock, clockKey, clockKey);
