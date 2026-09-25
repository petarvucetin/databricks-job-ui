import { useCallback, useEffect, useState } from 'react';
import type { RunsResponse } from '../../../shared/domain/types';

export type RunsState =
  | { state: 'loading' }
  | { state: 'error'; message: string; retry: () => void }
  | { state: 'ready'; data: RunsResponse; loadedAt: number };

export function useRuns(): RunsState {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; value: RunsState } | null>(null);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/runs?tzOffset=${new Date().getTimezoneOffset()}`, { signal: AbortSignal.timeout(15000) })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as RunsResponse;
        if (alive) setResult({ attempt, value: { state: 'ready', data, loadedAt: Date.now() } });
      })
      .catch((err: unknown) => {
        const message = err instanceof DOMException && err.name === 'TimeoutError'
          ? 'Could not load runs: request timed out'
          : `Could not load runs: ${err instanceof Error ? err.message : String(err)}`;
        if (alive) setResult({ attempt, value: { state: 'error', message, retry } });
      });
    return () => {
      alive = false;
    };
  }, [attempt, retry]);

  return result && result.attempt === attempt ? result.value : { state: 'loading' };
}
