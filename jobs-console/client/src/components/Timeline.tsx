import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { RUN_KINDS, type Run, type RunKind } from '../../../shared/domain/types';
import { fmtEdge, fmtEdgeEnd } from '../../../shared/domain/format';
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

export function Timeline({ runs, end, scale, window, cube, collapsed, dispatch }: {
  runs: Run[];
  end: number;
  scale: ScaleId;
  window: TimeWindow;
  cube: { col: number; kind: RunKind } | null;
  /** One line with just the selected date range (T toggles). */
  collapsed?: boolean;
  dispatch: (a: Action) => void;
}) {
  const bks = useMemo(() => buckets(scale, end), [scale, end]);
  const counts = useMemo(() => countByBucket(runs, bks), [runs, bks]);
  const used = RUN_KINDS.filter((k) => counts.some((c) => c[k]));
  const inside = bks.map((b) => b.end > window.from && b.start < window.to);
  const first = inside.indexOf(true);
  const last = inside.lastIndexOf(true);
  const d0 = domainStart(scale, end);
  const span = end - d0;
  const a = Math.max(0, (window.from - d0) / span);
  const b = Math.min(1, (window.to - d0) / span);
  const lineRef = useRef<HTMLDivElement>(null);
  // Track width in px, so the start label hides only when it would collide with the end label (as in the prototype).
  const [lineWidth, setLineWidth] = useState(0);
  useEffect(() => {
    const el = lineRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setLineWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed]);
  const showStartLabel = lineWidth === 0 || (b - a) * lineWidth >= 90;

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

  // A double-click anywhere in a column arrives as click (detail 1) then click (detail 2). The first click
  // may already have selected the day or a count, so the move uses the window from before it.
  const beforeClick = useRef(window);
  const clickCol = (i: number, detail: number) => {
    if (detail <= 1) beforeClick.current = window;
    else if (detail === 2) dispatch({ type: 'moveWindow', col: i, window: beforeClick.current });
  };

  const fromText = fmtEdge(window.from);
  const toText = fmtEdgeEnd(window.to);
  const rangeText = `${fromText === toText ? fromText : `${fromText} to ${toText}`}, ${spanText(window.to - window.from)}`;

  if (collapsed) {
    return (
      <section className="tl tl-min" aria-label="Timeline, collapsed">
        <span className="tl-span">{rangeText}</span>
        <span className="tl-key">T to expand</span>
      </section>
    );
  }

  return (
    <section className="tl">
      <div className="tl-head-row">
        <span className="tl-t">Runs by {SCALES[scale].unit}</span>
        <span className="tl-scale">
          {SCALE_ORDER.map((s) => (
            <button key={s} type="button" className={s === scale ? 'on' : ''} onClick={() => dispatch({ type: 'scale', scale: s })}>{s}</button>
          ))}
        </span>
        <span className="tl-span">{rangeText}</span>
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
            <div key={bk.start} className={`tl-col${on ? ' on' : ''}${inside[i] ? '' : ' dim'}`} style={{ gridColumn: i + 1, gridRow: 1 }} title={`${L.title}, ${c.n} runs. Double-click to centre the window here`} onClick={(e) => clickCol(i, e.detail)}>
              <button type="button" className="tl-head" onClick={(e) => e.detail < 2 && dispatch({ type: 'column', col: i })}>
                {L.num}
                <small className={L.month ? 'mon' : undefined}>{L.small || ' '}</small>
              </button>
              <div className="tl-cubes">
                {used.map((k) => {
                  const n = c[k];
                  if (!n) return <span key={k} className="tl-empty" />;
                  const sel = cube !== null && cube.col === i && cube.kind === k;
                  return (
                    <button key={k} type="button" className={`cube ${k}${sel ? ' sel' : ''}`} title={`${L.title}: ${n} ${k}`} onClick={(e) => e.detail < 2 && dispatch({ type: 'cube', col: i, kind: k })}>
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
        {showStartLabel && <span className="tl-lab" style={{ left: `${a * 100}%`, transform: a === 0 ? 'none' : 'translateX(-50%)' }}>{fmtEdge(window.from)}</span>}
        <span className="tl-lab" style={{ left: `${b * 100}%`, transform: b >= 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>{fmtEdgeEnd(window.to)}</span>
      </div>
    </section>
  );
}
