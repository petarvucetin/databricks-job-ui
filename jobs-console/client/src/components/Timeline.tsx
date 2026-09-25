import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { RUN_KINDS, type Run, type RunKind } from '../../../shared/domain/types';
import { fmtEdge } from '../../../shared/domain/format';
import type { TimeWindow } from '../model/filters';
import type { Action } from '../model/viewState';
import {
  SCALES, SCALE_ORDER, buckets, columnLabel, countByBucket, domainStart, dragHandle, presetWindow, sameWindow, shiftWindow, spanText,
  type Preset, type ScaleId,
} from '../model/timeline';
import './timeline.css';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'all', label: 'all' },
  { id: 'last7', label: 'last 7 days' },
  { id: 'last2', label: 'last 2 days' },
  { id: 'today', label: 'today' },
];

export function Timeline({ runs, end, scale, window, cube, dispatch }: {
  runs: Run[];
  end: number;
  scale: ScaleId;
  window: TimeWindow;
  cube: { col: number; kind: RunKind } | null;
  dispatch: (a: Action) => void;
}) {
  const bks = buckets(scale, end);
  const counts = countByBucket(runs, bks);
  const used = RUN_KINDS.filter((k) => counts.some((c) => c[k]));
  const inside = bks.map((b) => b.end > window.from && b.start < window.to);
  const first = inside.indexOf(true);
  const last = inside.lastIndexOf(true);
  const d0 = domainStart(scale, end);
  const span = end - d0;
  const a = Math.max(0, (window.from - d0) / span);
  const b = Math.min(1, (window.to - d0) / span);
  const lineRef = useRef<HTMLDivElement>(null);

  const colFromPointer = (clientX: number) => {
    const r = lineRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * bks.length);
  };

  const trackDrag = (e: ReactPointerEvent<HTMLDivElement>, nextFor: (ev: PointerEvent) => TimeWindow) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let current = window;
    const move = (ev: PointerEvent) => {
      const next = nextFor(ev);
      if (!sameWindow(next, current)) {
        current = next;
        dispatch({ type: 'window', window: next });
      }
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  const startHandleDrag = (which: 'from' | 'to') => (e: ReactPointerEvent<HTMLDivElement>) => {
    trackDrag(e, (ev) => dragHandle(bks, window, which, colFromPointer(ev.clientX)));
  };

  const startBarDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (sameWindow(window, { from: d0, to: end })) return;
    const x0 = e.clientX;
    const colWidth = (lineRef.current?.getBoundingClientRect().width ?? 1) / bks.length;
    const start = window;
    trackDrag(e, (ev) => shiftWindow(bks, start, Math.round((ev.clientX - x0) / colWidth)));
  };

  return (
    <section className="tl">
      <div className="tl-head-row">
        <span className="tl-t">Runs by {SCALES[scale].unit}</span>
        <span className="tl-scale">
          {SCALE_ORDER.map((s) => (
            <button key={s} type="button" className={s === scale ? 'on' : ''} onClick={() => dispatch({ type: 'scale', scale: s })}>{s}</button>
          ))}
        </span>
        <span className="tl-span">{`${fmtEdge(window.from)} to ${fmtEdge(window.to)}, ${spanText(window.to - window.from)}`}</span>
        <span className="tl-presets">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className={!cube && sameWindow(window, presetWindow(p.id, scale, end)) ? 'on' : ''} onClick={() => dispatch({ type: 'preset', preset: p.id })}>{p.label}</button>
          ))}
        </span>
      </div>
      <div className="tl-grid" style={{ gridTemplateColumns: `repeat(${bks.length}, 1fr)` }}>
        {first >= 0 && (
          <div className="tl-win" style={{ gridColumn: `${first + 1} / ${last + 2}`, gridRow: 1 }}>
            {last > first && <span className="tl-win-n">{spanText(window.to - window.from)}</span>}
          </div>
        )}
        {bks.map((bk, i) => {
          const L = columnLabel(scale, bk, i, bks[i - 1]);
          const c = counts[i];
          const on = sameWindow(window, { from: bk.start, to: bk.end });
          return (
            <div key={bk.start} className={`tl-col${on ? ' on' : ''}${inside[i] ? '' : ' dim'}`} style={{ gridColumn: i + 1, gridRow: 1 }} title={`${L.title}, ${c.n} runs`}>
              <button type="button" className="tl-head" onClick={() => dispatch({ type: 'column', col: i })}>
                {L.num}
                <small className={L.month ? 'mon' : undefined}>{L.small || ' '}</small>
              </button>
              <div className="tl-cubes">
                {used.map((k) => {
                  const n = c[k];
                  if (!n) return <span key={k} className="tl-empty" />;
                  const sel = cube !== null && cube.col === i && cube.kind === k;
                  return (
                    <button key={k} type="button" className={`cube ${k}${sel ? ' sel' : ''}`} title={`${L.title}: ${n} ${k}`} onClick={() => dispatch({ type: 'cube', col: i, kind: k })}>
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="tl-line" ref={lineRef}>
        <div className="tl-sel" style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }} onPointerDown={startBarDrag} />
        <div className="tl-handle" style={{ left: `${a * 100}%` }} onPointerDown={startHandleDrag('from')} aria-label="window start" role="slider" aria-valuenow={window.from} />
        <div className="tl-handle" style={{ left: `${b * 100}%` }} onPointerDown={startHandleDrag('to')} aria-label="window end" role="slider" aria-valuenow={window.to} />
        {(b - a) * 100 > 8 && <span className="tl-lab" style={{ left: `${a * 100}%`, transform: a === 0 ? 'none' : 'translateX(-50%)' }}>{fmtEdge(window.from)}</span>}
        <span className="tl-lab" style={{ left: `${b * 100}%`, transform: b >= 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>{fmtEdge(window.to)}</span>
      </div>
    </section>
  );
}
