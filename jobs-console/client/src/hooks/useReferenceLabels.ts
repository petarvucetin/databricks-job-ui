import { useEffect, useState } from 'react';

const KEY = 'jobs-console:labels';

/** Reference labels (numbered badges + legend) for design reviews. L toggles; the choice is remembered. */
export function useReferenceLabels(): boolean {
  const [on, setOn] = useState(() => localStorage.getItem(KEY) === '1');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key !== 'l' && e.key !== 'L') return;
      setOn((v) => {
        localStorage.setItem(KEY, v ? '0' : '1');
        return !v;
      });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return on;
}
