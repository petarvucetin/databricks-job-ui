import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { RUN_KINDS, type Run } from '../../../shared/domain/types';
import { dur } from '../../../shared/domain/format';
import type { Action } from '../model/viewState';
import {
  columnText, countByColumn, dragRuntimeHandle, edgeText, inRuntime, normalise, rangeText, runtimeColumns, runtimeOf, sameRange,
  type RuntimeRange,
} from '../model/runtime';

/**
 * Second slider in the timeline card: runs by runtime, shortest left to longest right, with the same count boxes and
 * handles as the time window. `runs` are the runs every other filter lets through except status, search and this one.
 */
export function RuntimeSlider({ runs, range, collapsed, dispatch }: {
  runs: Run[];
  range: RuntimeRange | null;
  /** The timeline is collapsed (T): just the range text, and only while it filters. */
  collapsed?: boolean;
  dispatch: (a: Action) => void;
}) {
  const cols = useMemo(() => runtimeColumns(runs, range), [runs, range]);
  const counts = useMemo(() => countByColumn(runs, cols), [runs, cols]);
  const lineRef = useRef<HTMLDivElement>(null);
  const text = rangeText(range);
  if (collapsed) return range ? <span className="rt-min">, {text}</span> : null;
  if (!cols.length) return null;

  const used = RUN_KINDS.filter((k) => counts.some((c) => c[k]));
  const inside = cols.map((c) => !range || (c.min >= range.min && c.max <= range.max));
  const first = inside.indexOf(true);
  const last = inside.lastIndexOf(true);
  const n = cols.length;
  const a = first < 0 ? 0 : first / n;
  const b = last < 0 ? 1 : (last + 1) / n;
  const shown = runs.filter((r) => inRuntime(r, range));
  const shortest = Math.min(...runs.map(runtimeOf));
  const longest = Math.max(...runs.map(runtimeOf));
  const set = (next: RuntimeRange | null) => dispatch({ type: 'runtime', runtime: next });

  const edgeFromPointer = (clientX: number) => {
    const r = lineRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * n);
  };

  const startHandleDrag = (which: 'min' | 'max') => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let current = range;
    const move = (ev: PointerEvent) => {
      const next = dragRuntimeHandle(cols, current, which, edgeFromPointer(ev.clientX));
      if (!sameRange(next, current)) {
        current = next;
        set(next);
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

  // A column click narrows to that column; clicking the only selected column again goes back to any runtime.
  const clickCol = (c: RuntimeRange) => {
    const one = normalise(c, cols);
    set(sameRange(range, one) ? null : one);
  };
  // "From here up": the column and everything longer.
  const fromCol = (c: RuntimeRange) => set(normalise({ min: c.min, max: Infinity }, cols));

  return (
    <div className="rt">
      <div className="tl-head-row">
        <span className="tl-t">Runs by runtime</span>
        <span className="tl-span"><b>{text}</b>, {shown.length} {shown.length === 1 ? 'run' : 'runs'}</span>
        <span className="tl-presets">
          <button type="button" className={range ? '' : 'on'} onClick={() => set(null)}>any</button>
        </span>
      </div>
      <div className="tl-grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {range && first >= 0 && <div className="tl-win" style={{ gridColumn: `${first + 1} / ${last + 2}`, gridRow: 1 }} />}
        {cols.map((c, i) => {
          const L = columnText(c);
          const k = counts[i];
          const total = RUN_KINDS.reduce((s, x) => s + k[x], 0);
          return (
            <div key={c.min} className={`tl-col${inside[i] ? '' : ' dim'}`} style={{ gridColumn: i + 1, gridRow: 1 }} title={`${L.title}, ${total} runs. Click for just these, double-click for these and longer`} onClick={(e) => e.detail === 2 && fromCol(c)}>
              <button type="button" className="tl-head" onClick={(e) => e.detail < 2 && clickCol(c)}>
                {L.num}
                <small>{L.unit}</small>
              </button>
              <div className="tl-cubes">
                {used.map((kind) => {
                  const x = k[kind];
                  if (!x) return <span key={kind} className="tl-empty" />;
                  return (
                    <button key={kind} type="button" className={`cube ${kind}`} title={`${L.title}: ${x} ${kind}`} onClick={(e) => e.detail < 2 && clickCol(c)}>
                      {x}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="tl-line" ref={lineRef}>
        <div className="tl-sel" style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%`, cursor: 'default' }} />
        <div className="tl-handle" style={{ left: `${a * 100}%` }} onPointerDown={startHandleDrag('min')} aria-label="shortest runtime" role="slider" aria-valuenow={range?.min ?? cols[0].min} />
        <div className="tl-handle" style={{ left: `${b * 100}%` }} onPointerDown={startHandleDrag('max')} aria-label="longest runtime" role="slider" aria-valuenow={range?.max ?? cols[n - 1].max} />
        <span className="tl-lab" style={{ left: `${a * 100}%`, transform: a === 0 ? 'none' : 'translateX(-50%)' }}>{a === 0 ? `shortest ${dur(shortest)}` : edgeText(cols[first].min)}</span>
        <span className="tl-lab" style={{ left: `${b * 100}%`, transform: b >= 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
          {b >= 1 ? `longest ${dur(longest)}` : edgeText(cols[last].max)}
        </span>
      </div>
    </div>
  );
}
