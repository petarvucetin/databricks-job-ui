import { useEffect, useRef } from 'react';
import type { Run } from '../../../shared/domain/types';
import { dur, durLive, fmtStart } from '../../../shared/domain/format';
import { chainSummary, elapsedSec, splitName, taskRows } from '../model/rowView';
import './drawer.css';

const RESULT_LABEL = { succeeded: 'succeeded', failed: 'failed', cancelled: 'cancelled', partial: 'partially succeeded' } as const;
const STATE_LABEL = { ok: 'succeeded', f: 'failed', s: 'skipped', r: 'running', p: 'waiting' } as const;

/** Side drawer for one run, opened from a run history box; closes on Escape, the scrim, or ×. */
export function RunDrawer({ run, nowMs, loadedAt, onClose }: { run: Run; nowMs: number; loadedAt: number; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const elapsed = elapsedSec(run, nowMs, loadedAt);
  const { prefix, rest } = splitName(run.name);
  const tasks = taskRows(run, elapsed);
  const summary = chainSummary(run, elapsed);
  return (
    <>
      <div className="dr-scrim" onClick={onClose} />
      <aside className="dr" role="dialog" aria-modal="true" aria-label={`Run of ${run.name}`} data-c="17">
        <header className="dr-h">
          <span className={`rr-tag ${run.type}`}>{run.type === 'pipeline' ? 'Pipeline' : 'Job'}</span>
          <span className="dr-name"><i>{prefix}</i>{rest}</span>
          <button ref={closeRef} type="button" className="dr-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="dr-meta">
          <span className={`dr-r ${run.live ? 'now' : run.result ?? ''}`}>{run.live ? 'running now' : RESULT_LABEL[run.result ?? 'failed']}</span>
          <span>{fmtStart(run.startTime)}</span>
          <span>{run.live ? durLive(elapsed) : dur(elapsed)}</span>
          <span className="dr-dim">average {dur(run.usualSec)}</span>
          <span className="dr-dim">run as <b>{run.runAs}</b></span>
        </div>
        <section className="dr-tasks">
          <div className="dr-sec">
            <span>{run.type === 'pipeline' ? 'Flows' : 'Tasks'}</span>
            <em>{summary}</em>
          </div>
          <ol>
            {tasks.map((t, i) => (
              <li key={i} className={`dr-t ${t.state}`}>
                <i />
                <span className="dr-tn">{t.name}</span>
                <span className="dr-ts">{t.failure ? t.failure.cause.label : STATE_LABEL[t.state]}</span>
                {t.failure && <code>{t.failure.cause.code}</code>}
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </>
  );
}
