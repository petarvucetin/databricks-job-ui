import { useEffect, useRef, type CSSProperties } from 'react';
import type { Run } from '../../../shared/domain/types';
import { dur, fmtStart } from '../../../shared/domain/format';
import { elapsedSec, splitName } from '../model/rowView';
import { schedule, spanSec, ticks } from '../model/runDetail';
import { compareRows, paramRows } from '../model/compare';
import { dayTime, durShort, visibleHistory } from '../model/history';
import { useTabActiveRef } from '../hooks/useTabActive';
import './drawer.css';
import './runrow.css';
import './compare.css';

const RESULT = { succeeded: 'succeeded', failed: 'failed', cancelled: 'cancelled', partial: 'partially succeeded' } as const;
const BAR = { ok: '', f: ' f', s: ' s', r: ' r', p: ' s' } as const;

/** Runs of one job side by side (B): totals, parameters, tasks on one time scale, and each run's cause. */
export function CompareView({ runs, pool, onToggle, nowMs, loadedAt, addHint, onRemove, onClose }: {
  /** Oldest first, all of one job. */
  runs: Run[];
  /** This job's runs to pick from (oldest first); clicking one adds or removes it. */
  pool?: Run[];
  onToggle?: (id: number) => void;
  nowMs: number;
  loadedAt: number;
  addHint: string;
  onRemove?: (id: number) => void;
  onClose?: () => void;
}) {
  const first = runs[0];
  if (!first) return null;
  const n = runs.length;
  const elapsed = runs.map((r) => elapsedSec(r, nowMs, loadedAt));
  const max = Math.max(...runs.map((r, i) => spanSec(r, elapsed[i] ?? 0)), first.usualSec);
  const rows = compareRows(runs, runs.map((r, i) => schedule(r, elapsed[i])));
  const params = paramRows(runs);
  const { prefix, rest } = splitName(first.name);
  const grid = { '--n': String(n) } as CSSProperties;
  const pct = (s: number) => `${(100 * s) / max}%`;
  const inView = new Set(runs.map((r) => r.id));
  const picks = visibleHistory(pool ?? []);

  return (
    <div className="cmpv">
      <div className="cmp-h">
        <div className="top">
          <span className="title"><i>{prefix}</i>{rest}</span>
          <span className="pill">{n} runs</span>
          {onClose && <button type="button" className="x" aria-label="Close" onClick={onClose}>×</button>}
        </div>
        {pool && onToggle && (
          <div className="pool">
            <span className="pool-t">Runs</span>
            {picks.earlier > 0 && <span className="rh-more">+{picks.earlier} earlier</span>}
            {picks.shown.map((h) => (
              <button
                key={h.id}
                type="button"
                className={`rh ${h.live ? `now ${h.type}` : h.result ?? ''}${inView.has(h.id) ? ' pick' : ''}`}
                aria-pressed={inView.has(h.id)}
                aria-label={`${fmtStart(h.startTime)}, ${h.live ? 'running now' : RESULT[h.result ?? 'failed']}`}
                onClick={() => onToggle(h.id)}
              >
                <span className="rh-t">{h.live ? 'now' : durShort(h.durationSec)}</span>
                <span className="rh-w">{dayTime(h.startTime)}</span>
              </button>
            ))}
            <span className="add">{addHint}</span>
          </div>
        )}
        <div className="grid runs" style={grid}>
          <div />
          {runs.map((r, i) => (
            <div key={r.id} className={`chip ${r.live ? 'now' : r.result ?? ''}`}>
              <b>{r.live ? 'running' : RESULT[r.result ?? 'failed']}</b>
              <span>{fmtStart(r.startTime)}</span>
              <span className="d">{dur(elapsed[i] ?? 0)}</span>
              {onRemove && <button type="button" className="cx" aria-label={`Remove ${fmtStart(r.startTime)}`} onClick={() => onRemove(r.id)}>×</button>}
            </div>
          ))}
          <div />
        </div>
      </div>

      <section className="sec">
        <h4>Run</h4>
        <div className="grid bars" style={grid}>
          <div className="n dim">total, | = usual</div>
          {runs.map((r, i) => (
            <div key={r.id}>
              <div className="bx"><i className={r.live ? 'now' : r.result ?? ''} style={{ width: pct(elapsed[i] ?? 0) }} /><u style={{ left: pct(r.usualSec) }} /></div>
              <div className="v">{dur(elapsed[i] ?? 0)}</div>
            </div>
          ))}
          <div />
        </div>
      </section>

      <section className="sec">
        <h4>Parameters</h4>
        {params.map((p) => (
          <div key={p.key} className="grid row prm" style={grid}>
            <div className="n">{p.key}</div>
            {p.values.map((v, i) => <div key={i} className={`cell${v === null ? ' unset' : ''}`}>{v ?? 'not set'}</div>)}
            <div />
          </div>
        ))}
      </section>

      <section className="sec">
        <h4>Tasks<em>every task from any run, one time scale</em></h4>
        <div className="grid axisrow" style={grid}>
          <div />
          {runs.map((r) => <div key={r.id} className="tk">{ticks(max).map((t, k) => <span key={k} style={{ left: `${k * 25}%` }}>{t}</span>)}</div>)}
          <div className="dlt">difference</div>
        </div>
        {rows.map((row) => (
          <div key={row.key} className={`grid row${row.tone ? ` ${row.tone}` : ''}`} style={grid}>
            <div className="n">{row.name}</div>
            {row.cells.map((t, i) => {
              if (!t) return <div key={i} className="tk none"><span className="t">not in this run</span></div>;
              const gone = t.state === 's' || t.state === 'p';
              const w = gone ? '2.5%' : `${Math.max(0.8, (100 * t.dur) / max)}%`;
              const label = t.state === 's' ? 'skipped' : t.state === 'p' ? 'not started' : t.state === 'r' ? 'running' : t.state === 'f' ? `${dur(t.dur)}, failed` : dur(t.dur);
              const slow = row.tone === 'slow' && row.slowIdx === i ? ' slow' : '';
              return (
                <div key={i} className="tk">
                  <span className={`b${BAR[t.state]}${slow}`} style={{ left: pct(t.start), width: w }} />
                  <span className="t" style={{ left: `calc(${pct(t.start + (gone ? max * 0.025 : t.dur))} + 5px)` }}>{label}</span>
                </div>
              );
            })}
            <div className={`dlt ${row.tone}`}>{row.note}</div>
          </div>
        ))}
      </section>

      <section className="sec root">
        <h4>Root</h4>
        <div className="grid" style={grid}>
          <div />
          {runs.map((r) => {
            const bad = r.result === 'failed' || r.kind === 'queued' || r.kind === 'retrying';
            return <div key={r.id} className={`cell ${bad ? 'err' : 'ok'}`}>{bad ? `${r.cause.label} · ${r.cause.detail}` : r.live ? 'running' : 'no error'}</div>;
          })}
          <div />
        </div>
      </section>
    </div>
  );
}

/** The comparison as a wide drawer over the list: Escape, the scrim or × closes it. */
export function CompareDrawer(props: Parameters<typeof CompareView>[0] & { onClose: () => void }) {
  const { onClose } = props;
  const ref = useRef<HTMLElement>(null);
  const tabActive = useTabActiveRef();
  useEffect(() => {
    ref.current?.focus();
    // Nothing while the Runs tab is hidden (an Esc or a click on the other tab is not meant for this drawer).
    const onKey = (e: KeyboardEvent) => tabActive.current && e.key === 'Escape' && onClose();
    // Clicks outside close it, except on run history boxes, which open or stack runs.
    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (tabActive.current && t instanceof Element && !t.closest('.dr, .rh')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [onClose, tabActive]);
  return (
    <>
      <div className="dr-scrim still" />
      <aside ref={ref} tabIndex={-1} className="dr wide" role="dialog" aria-modal="true" aria-label="Compare runs" data-c="18">
        <CompareView {...props} />
      </aside>
    </>
  );
}
