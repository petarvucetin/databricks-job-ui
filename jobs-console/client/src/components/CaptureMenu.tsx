import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../lib/env';

const SWEEP_DAYS = 90;

function fileNameOf(res: Response): string {
  const cd = res.headers.get('Content-Disposition') ?? '';
  return /filename="([^"]+)"/.exec(cd)?.[1] ?? 'jobs-console-capture.json.gz';
}

async function sweepAndDownload(): Promise<void> {
  const res = await fetch(apiUrl(`/api/diag/sweep?days=${SWEEP_DAYS}`));
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fileNameOf(res);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Live mode: quiet "Capture" text in the top bar, opening two text items. */
export function CaptureMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (ev: MouseEvent | KeyboardEvent) => {
      if (ev instanceof KeyboardEvent ? ev.key === 'Escape' : !ref.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const sweep = () => {
    setOpen(false);
    setBusy(true);
    setError(null);
    sweepAndDownload()
      .catch((e: unknown) => setError(`Sweep failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setBusy(false));
  };

  return (
    <div className="capture" ref={ref}>
      {busy ? (
        <span className="capture-busy">Sweeping {SWEEP_DAYS} days…</span>
      ) : (
        <button type="button" className="capture-toggle" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Capture
        </button>
      )}
      {error && !busy && <span className="capture-error">{error}</span>}
      {open && (
        <div className="capture-menu" role="menu">
          <a role="menuitem" href={apiUrl('/api/diag/capture')} download onClick={() => setOpen(false)}>
            Download capture
          </a>
          <button type="button" role="menuitem" onClick={sweep}>
            Sweep {SWEEP_DAYS} days + download
          </button>
        </div>
      )}
    </div>
  );
}
