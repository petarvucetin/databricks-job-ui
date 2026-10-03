import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { Run } from '../../../shared/domain/types';
import { dur } from '../../../shared/domain/format';
import type { Action } from '../model/viewState';
import { barIndex, barRange, dragRuntime, handlePositions, histogram, inRuntime, nearestEdge, rangeText, runtimeOf, runtimeScale, sameRange, type RuntimeRange } from '../model/runtime';

const BARS = 40;

/**
 * The Runtime group at the end of the status tiles: small bars of where the runs fall, shortest left to longest right,
 * and two handles that narrow the rows to a runtime range. `runs` are what every other filter lets through except
 * status, search and this one. Clicking a bar shows just that bar's runs (`bar`); the handles stay where they are.
 */
export function RuntimeTile({ runs, range, bar = null, dispatch }: { runs: Run[]; range: RuntimeRange | null; bar?: RuntimeRange | null; dispatch: (a: Action) => void }) {
  const scale = useMemo(() => runtimeScale(runs), [runs]);
  const bars = useMemo(() => histogram(runs, scale, BARS), [runs, scale]);
  const trackRef = useRef<HTMLDivElement>(null);
  const [a, b] = handlePositions(scale, range);
  const sel = barIndex(scale, bar, BARS);
  const picked = runs.filter((r) => inRuntime(r, range) && inRuntime(r, bar));
  // Rows are jobs: how many jobs have a run in the range (and the clicked bar).
  const shown = new Set(picked.map((r) => r.name)).size;
  const filtering = range !== null || bar !== null;
  const barSecs = bar ? runs.filter((r) => inRuntime(r, bar)).map(runtimeOf) : [];
  const title = !bar ? rangeText(range) : !barSecs.length ? 'no runs in this bar' : Math.min(...barSecs) === Math.max(...barSecs) ? `runs of ${dur(barSecs[0])}` : `${dur(Math.min(...barSecs))} to ${dur(Math.max(...barSecs))}`;
  const top = Math.max(1, ...bars);
  const set = (next: RuntimeRange | null) => dispatch({ type: 'runtime', runtime: next });

  const startDrag = (which: 'min' | 'max') => (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let current = range;
    const move = (ev: PointerEvent) => {
      const r = trackRef.current?.getBoundingClientRect();
      if (!r || r.width === 0) return;
      const pos = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      const next = dragRuntime(scale, current, which, nearestEdge(scale, pos));
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

  return (
    <section className="tile-grp rt-grp" aria-label="Runtime">
      <span className="tile-grp-t">Runtime</span>
      <div className={`tile rt-tile${filtering ? ' amber on' : ''}`}>
        <div className="rt-top">
          <b>{title}</b>
          <span>{filtering ? `${shown} ${shown === 1 ? 'job' : 'jobs'}` : runs.length ? `shortest ${dur(Math.min(...runs.map(runtimeOf)))} · longest ${dur(scale.longest)}` : 'no runs'}</span>
          {filtering && <button type="button" onClick={() => dispatch({ type: 'runtime', runtime: null, bar: null })}>any</button>}
        </div>
        <div className="rt-track" ref={trackRef}>
          <span className="rt-bars">
            {bars.map((n, i) =>
              n ? (
                <button
                  // eslint-disable-next-line react/no-array-index-key -- a bar is its slice of the track; the position is its identity.
                  key={i}
                  type="button"
                  className={`rt-bar${i === sel ? ' sel' : ''}`}
                  style={{ left: `${(i / BARS) * 100}%`, width: `${100 / BARS}%` }}
                  title={`${n} ${n === 1 ? 'run' : 'runs'}; click to show just these, again to clear`}
                  aria-pressed={i === sel}
                  onClick={() => dispatch({ type: 'runtime', runtime: range, bar: i === sel ? null : barRange(scale, i, BARS) })}
                >
                  <i className={range && (i + 0.5) / BARS >= a && (i + 0.5) / BARS <= b ? 'in' : undefined} style={{ height: 3 + (n / top) * 11 }} />
                </button>
              ) : null,
            )}
          </span>
          {range && <span className="rt-sel" style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }} />}
          <span className="rt-h" style={{ left: `${a * 100}%` }} onPointerDown={startDrag('min')} role="slider" aria-label="shortest runtime" aria-valuenow={range?.min ?? 0} />
          <span className="rt-h" style={{ left: `${b * 100}%` }} onPointerDown={startDrag('max')} role="slider" aria-label="longest runtime" aria-valuenow={range?.max ?? scale.longest} />
        </div>
      </div>
    </section>
  );
}
