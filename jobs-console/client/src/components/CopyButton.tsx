import { useEffect, useRef, useState, type MouseEvent } from 'react';
import './copy.css';

/** Copies through a hidden textarea: navigator.clipboard is missing on plain http. */
function copyFallback(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    ta.remove();
  }
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) return await navigator.clipboard.writeText(text);
  } catch {
    // denied or not a secure context: fall through
  }
  copyFallback(text);
}

/** A small clipboard icon that copies `value`; a check and "Copied" show for 1.2s. Never lets the click reach the row under it. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [ok, setOk] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    void copyText(value).finally(() => {
      setOk(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setOk(false), 1200);
    });
  };
  const name = `Copy ${label ?? 'value'}`;
  return (
    <button type="button" className={`cp${ok ? ' ok' : ''}`} title={name} aria-label={name} onClick={onClick}>
      {ok ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="3" y="3" width="10" height="11.5" rx="1.5" /><rect x="5.5" y="1.5" width="5" height="3" rx="1" fill="var(--sheet)" /></svg>
      )}
      {ok && <span className="cp-tip" role="status">Copied</span>}
    </button>
  );
}
