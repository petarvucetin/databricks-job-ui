import { useEffect, useState } from 'react';

export type TaskLogState = { state: 'loading' } | { state: 'error' } | { state: 'ready'; text: string };

/** Log of one task in a run; `hint` (failure cause or "retrying") lets the mock source write a matching ending. */
export function useTaskLog(runId: number, task: string, hint?: string): TaskLogState {
  const key = `${runId}/${task}/${hint ?? ''}`;
  const [result, setResult] = useState<{ key: string; value: TaskLogState } | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const q = new URLSearchParams({ task, ...(hint ? { hint } : {}) });
    fetch(`/api/runs/${runId}/log?${q.toString()}`, { signal: ctl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { text: string };
        setResult({ key, value: { state: 'ready', text: body.text } });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setResult({ key, value: { state: 'error' } });
      });
    return () => ctl.abort();
  }, [key, runId, task, hint]);
  return result && result.key === key ? result.value : { state: 'loading' };
}
