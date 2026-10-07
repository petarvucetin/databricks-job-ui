import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { Item } from '../../../shared/domain/types';
import { pad } from '../../../shared/domain/format';
import { PRESETS, dayName, dragHandle, isNarrowed, schedCounts, unscheduledCounts, when, winOf, type Bucket, type SchedState } from '../model/schedule';
import './timeline.css';

const H = 3600e3;
function spanText(ms: number) {
  const h = Math.round(ms / H);
  return h < 24 ? `${h} hour${h > 1 ? 's' : ''}` : `${Math.round(h / 24)} day${h > 24 ? 's' : ''}`;
}

/**
 * "Scheduled starts by hour / day": job and pipeline starts per column over the next 24 hours or 7 days. Handles,
 * presets, a column head or a box narrow the window; the list then keeps only items starting inside it.
 * `items` are the filtered items, the schedule window itself not applied.
 */
export function ScheduleTimeline({ items, bks, state, onChange }: { items: Item[]; bks: Bucket[]; state: SchedState; onChange: (s: SchedState) => void }) {
  const { scale, cube } = state;
  const counts = useMemo(() => schedCounts(items, bks), [items, bks]);
  const foot = useMemo(() => unscheduledCounts(items), [items]);
  const lineRef = useRef<HTMLDivElement>(null);
  const w = winOf(state, bks);
  const narrowed = isNarrowed(state, bks);
  const used = (['job', 'pipeline'] as const).filter((k) => counts.some((c) => c[k]));
  const from = bks[w.a].start, to = bks[w.b - 1].end;
  const a = w.a / bks.length, b = w.b / bks.length;
  const crosses = scale === 'hour' && new Date(from).getDate() !== new Date(to).getDate();
  const set = (p: Partial<SchedState>) => onChange({ ...state, ...p });

  const startHandleDrag = (which: 'a' | 'b') => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    let current = w;
    const move = (ev: PointerEvent) => {
      const r = lineRef.current?.getBoundingClientRect();
      if (!r || r.width === 0) return;
      const col = Math.round(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * bks.length);
      const next = dragHandle(current, which, col, bks.length);
      if (next.a !== current.a || next.b !== current.b) {
        current = next;
        onChange({ ...state, win: next, cube: null });
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
    <section className="tl">
      <div className="tl-head-row">
        <span className="tl-t">Scheduled starts by {scale}</span>
        <span className="tl-scale">
          {(['hour', 'day'] as const).map((s) => (
            <button key={s} type="button" className={scale === s ? 'on' : ''} onClick={() => onChange({ scale: s, win: null, cube: null })}>{s}</button>
          ))}
        </span>
        <span className="tl-span">
          <b>{crosses ? `${dayName(from)} ` : ''}{when(from, scale)}</b> to <b>{crosses ? `${dayName(to)} ` : ''}{when(to, scale)}</b>, {spanText(to - from)} · your local time
        </span>
        <span className="tl-presets">
          {PRESETS[scale].map((p) => (
            <button key={p.label} type="button" className={!cube && w.a === p.a && w.b === p.b ? 'on' : ''} onClick={() => set({ win: { a: p.a, b: p.b }, cube: null })}>{p.label}</button>
          ))}
        </span>
      </div>
      <div className="tl-grid" style={{ gridTemplateColumns: `repeat(${bks.length}, 1fr)` }}>
        {narrowed && !cube && (
          <div className="tl-win" style={{ gridColumn: `${w.a + 1} / ${w.b + 1}`, gridRow: 1 }}>
            {w.b - w.a > 1 && <span className="tl-win-n">{spanText(to - from)}</span>}
          </div>
        )}
        {bks.map((bk, i) => {
          const d = new Date(bk.start);
          const num = scale === 'hour' ? pad(d.getHours()) : d.getDate();
          const small = i === 0 ? <small className="now">now</small> : scale === 'hour' ? <small>{d.getHours() === 0 ? dayName(bk.start) : ' '}</small> : <small>{dayName(bk.start)}</small>;
          const inside = i >= w.a && i < w.b;
          const c = counts[i];
          return (
            <div key={bk.start} className={`tl-col${inside || cube ? '' : ' dim'}`} style={{ gridColumn: i + 1, gridRow: 1 }} title={`${when(bk.start, scale)}: ${c.job} job starts, ${c.pipeline} pipeline starts`}>
              <button type="button" className="tl-head" onClick={() => set({ win: w.a === i && w.b === i + 1 ? null : { a: i, b: i + 1 }, cube: null })}>{num}{small}</button>
              <div className="tl-cubes">
                {used.map((k) =>
                  c[k] ? (
                    <button
                      key={k}
                      type="button"
                      className={`cube ${k}${cube && cube.col === i && cube.type === k ? ' sel' : ''}`}
                      title={`${when(bk.start, scale)}: ${c[k]} ${k} starts`}
                      onClick={() => set({ cube: cube && cube.col === i && cube.type === k ? null : { col: i, type: k } })}
                    >
                      {c[k]}
                    </button>
                  ) : (
                    <span key={k} className="tl-empty" />
                  ),
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="tl-line" ref={lineRef}>
        <div className="tl-sel" style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }} />
        <div className="tl-handle" style={{ left: `${a * 100}%` }} onPointerDown={startHandleDrag('a')} role="slider" aria-label="window start" aria-valuenow={w.a} />
        <div className="tl-handle" style={{ left: `${b * 100}%` }} onPointerDown={startHandleDrag('b')} role="slider" aria-label="window end" aria-valuenow={w.b} />
        {b - a > 0.12 && <span className="tl-lab" style={{ left: `${a * 100}%`, transform: a === 0 ? 'none' : 'translateX(-50%)' }}>{when(from, scale)}</span>}
        <span className="tl-lab" style={{ left: `${b * 100}%`, transform: b >= 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>{when(to, scale)}</span>
      </div>
      <div className="tl-foot">
        <span className="k job"><i />job starts</span>
        <span className="k pipeline"><i />pipeline starts</span>
        <span className="tl-nosched">
          {narrowed ? `${foot.none} without a schedule hidden (manual, triggered, continuous, paused)` : `${foot.none} have no schedule (manual, triggered, continuous, paused)`}
          {foot.unparsed > 0 && ` · ${foot.unparsed} schedules not understood`}
        </span>
        {narrowed && <button type="button" className="tl-clear" onClick={() => set({ win: null, cube: null })}>clear schedule filter ✕</button>}
      </div>
    </section>
  );
}
