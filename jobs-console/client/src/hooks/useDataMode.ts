import { useCallback, useEffect, useState } from 'react';
import type { DataMode } from '../../../shared/domain/types';
import { apiUrl } from '../lib/env';

export type ModeState =
  | { state: 'loading' }
  | { state: 'ready'; mode: DataMode }
  | { state: 'error'; message: string; retry: () => void };

async function fetchMode(): Promise<DataMode> {
  const res = await fetch(apiUrl('/api/mode'));
  if (!res.ok) {
    // The server answers errors as { error }: show its message, not just the status.
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' ? `HTTP ${res.status}: ${body.error}` : `HTTP ${res.status}`);
  }
  return (await res.json()) as DataMode;
}

/** GET /api/mode: mock, live or replay, which env, whose authorization, and whether the Capture menu applies. A failure can be retried. */
export function useDataMode(): ModeState {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; mode: DataMode } | { attempt: number; message: string }>();
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  useEffect(() => {
    let alive = true;
    fetchMode().then(
      (mode) => {
        if (alive) setResult({ attempt, mode });
      },
      (err: unknown) => {
        if (alive) setResult({ attempt, message: `Could not load the console: ${err instanceof Error ? err.message : String(err)}` });
      },
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  if (!result || result.attempt !== attempt) return { state: 'loading' };
  return 'mode' in result ? { state: 'ready', mode: result.mode } : { state: 'error', message: result.message, retry };
}
