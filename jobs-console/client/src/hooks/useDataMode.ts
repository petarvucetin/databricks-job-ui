import { useEffect, useState } from 'react';
import type { DataMode } from '../../../shared/domain/types';
import { apiUrl } from '../lib/env';

/** GET /api/mode: mock, live or replay, whose authorization, and whether the Capture menu applies. Undefined until known. */
export function useDataMode(): DataMode | undefined {
  const [mode, setMode] = useState<DataMode>();
  useEffect(() => {
    let alive = true;
    fetch(apiUrl('/api/mode'))
      .then((res) => (res.ok ? (res.json() as Promise<DataMode>) : undefined))
      .then((m) => {
        if (alive && m) setMode(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return mode;
}
