import { useEffect, useState } from 'react';
import { useTabActiveRef } from './useTabActive';

/** A view switch flipped by a single letter key (ignored while typing in a field or while its tab is hidden); the choice is remembered. */
export function useKeyToggle(letter: string, storageKey: string, initial: boolean): boolean {
  const [on, setOn] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved === null ? initial : saved === '1';
  });
  const tabActive = useTabActiveRef();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!tabActive.current) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key.toLowerCase() !== letter) return;
      setOn((v) => {
        localStorage.setItem(storageKey, v ? '0' : '1');
        return !v;
      });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [letter, storageKey, tabActive]);
  return on;
}

/** Reference labels (numbered badges + legend) for design reviews. Shown by default; L toggles. */
export const useReferenceLabels = () => useKeyToggle('l', 'jobs-console:labels', true);

/** Run rows collapsed to just the name. Expanded by default; C toggles. */
export const useCompactRows = () => useKeyToggle('c', 'jobs-console:compact-rows', false);

/** Timeline collapsed to a single line with just the date range. Expanded by default; T toggles. */
export const useTimelineCollapsed = () => useKeyToggle('t', 'jobs-console:timeline-collapsed', false);
