import { useCallback, useState } from 'react';

export const REFRESH_OPTIONS: readonly { ms: number; label: string }[] = [
  { ms: 0, label: 'off' },
  { ms: 30_000, label: '30s' },
  { ms: 60_000, label: '1 min' },
  { ms: 120_000, label: '2 min' },
  { ms: 180_000, label: '3 min' },
  { ms: 240_000, label: '4 min' },
  { ms: 300_000, label: '5 min' },
];
const KEY = 'jobs-console:refresh-ms';
const DEFAULT_MS = 60_000;

/** The auto-refresh interval the user picked (0 = off), remembered in localStorage. Default 1 minute. */
export function useRefreshInterval(): [number, (ms: number) => void] {
  const [ms, setMs] = useState(() => {
    const saved = Number(localStorage.getItem(KEY));
    return REFRESH_OPTIONS.some((o) => o.ms === saved) && localStorage.getItem(KEY) !== null ? saved : DEFAULT_MS;
  });
  const set = useCallback((next: number) => {
    localStorage.setItem(KEY, String(next));
    setMs(next);
  }, []);
  return [ms, set];
}
