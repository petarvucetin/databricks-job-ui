import { useEffect, useState } from 'react';
import { apiUrl } from '../lib/env';

export type TaskLogState = { state: 'loading' } | { state: 'error' } | { state: 'ready'; text: string };

/**
 * Log of one task in a run; `hint` (failure cause or "retrying") lets the mock source write a matching ending.
 * A new `nonce` fetches the log again; the text already shown stays until the new one arrives (or if it fails).
 */
export function useTaskLog(runId: number, task: string, hint?: string, nonce = 0): TaskLogState {
  const base = `${runId}/${task}/${hint ?? ''}`;
  const key = `${base}#${nonce}`;
  const [result, setResult] = useState<{ key: string; base: string; value: TaskLogState } | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const q = new URLSearchParams({ task, ...(hint ? { hint } : {}) });
    fetch(apiUrl(`/api/runs/${runId}/log?${q.toString()}`), { signal: ctl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { text: string };
        setResult({ key, base, value: { state: 'ready', text: body.text } });
      })
      .catch(() => {
        if (ctl.signal.aborted) return;
        // A refetch that fails keeps the log already shown.
        setResult((prev) => (prev && prev.base === base && prev.value.state === 'ready' ? { ...prev, key } : { key, base, value: { state: 'error' } }));
      });
    return () => ctl.abort();
  }, [key, base, runId, task, hint]);
  if (result && result.key === key) return result.value;
  // Refetching the same log: keep showing what is there rather than flashing to "loading".
  if (result && result.base === base && result.value.state === 'ready') return result.value;
  return { state: 'loading' };
}
