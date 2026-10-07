import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Item, Run } from '../../../shared/domain/types';
import { pad } from '../../../shared/domain/format';
import { isOnTimeline, itemKey, startsOf } from '../model/items';
import { fmtN, groupOf, loadCurve, loadRuns, niceTicks, runningIn } from '../model/load';
import { dayName, hhmm, when as whenAt, type SchedScale } from '../model/schedule';
import { ItemRow, ViewSwitch, type ItemsView } from './ItemList';

const H = 3600e3;
const CAP = 200;
const W = 1000;
const HT = 200;

type At = { f: number; i: number; t: number };

/**
 * Load view: scheduled jobs expected to be running at once over the schedule window (from each schedule and its typical
 * runtime), with a y-axis, a crosshair tooltip, and drag-to-select; the list under it shows the jobs running in the
 * selection, or everything starting in range by first start. Ported from renderLoad() in the mockup.
 */
export function LoadView({ items, runs, from, to, now, scale, selected, onSelect, view, onView, partial }: {
  /** The filtered items (type, scope, tags, search), schedule window not applied. */
  items: Item[];
  runs: Run[];
  from: number;
  to: number;
  now: number;
  scale: SchedScale;
  selected: string | null;
  onSelect: (key: string | null) => void;
  view: ItemsView;
  onView: (v: ItemsView) => void;
  partial?: string;
}) {
  const span = to - from;
  const step = span <= 26 * H ? 5 * 60e3 : 30 * 60e3;
  const N = Math.max(1, Math.round(span / step));
  const when = (t: number) => whenAt(t, scale);

  const lr = useMemo(() => loadRuns(items, runs, from, to), [items, runs, from, to]);
  const { running, startsIn } = useMemo(() => loadCurve(lr, from, to, step), [lr, from, to, step]);
  const scheduled = useMemo(() => items.filter(isOnTimeline).length, [items]);
  const peak = useMemo(() => running.reduce((b, n, i) => (n > running[b] ? i : b), 0), [running]);
  const maxR = running[peak] ?? 0;
  const { ticks, top } = niceTicks(maxR);

  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ lo: number; hi: number } | null>(null);
  const dragFrom = useRef<At | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const at = (clientX: number): At => {
    const r = plotRef.current?.getBoundingClientRect();
    const raw = r ? (clientX - r.left) / (r.width || 1) : 0;
    const f = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    return { f, i: Math.round(f * N), t: from + f * span };
  };

  // The tooltip follows the pointer and stays inside the window.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || !hover) return;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(hover.x + 14, window.innerWidth - r.width - 8)}px`;
    tip.style.top = `${Math.min(hover.y + 16, window.innerHeight - r.height - 8)}px`;
  }, [hover]);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragFrom.current = at(e.clientX);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const a = dragFrom.current;
    if (!a) return;
    const b = at(e.clientX);
    setDrag({ lo: Math.min(a.f, b.f), hi: Math.max(a.f, b.f) });
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const a = dragFrom.current;
    if (!a) return;
    dragFrom.current = null;
    setDrag(null);
    const b = at(e.clientX);
    // Snapped to the sample step; a click selects one step.
    const snap = (t: number) => Math.round((t - from) / step) * step + from;
    let lo = snap(Math.min(a.t, b.t)), hi = snap(Math.max(a.t, b.t));
    if (hi - lo < step) {
      lo = Math.min(snap(a.t), to - step);
      hi = lo + step;
    }
    setSel({ a: lo, b: hi });
  };
  const onPointerCancel = () => {
    dragFrom.current = null;
    setDrag(null);
  };

  const pc = (t: number) => ((t - from) / span) * 100;
  const pts = running.map((n, i) => `${(i / N) * W},${HT - (n / top) * HT}`).join(' ');
  const every = span <= 7 * H ? 1 : span <= 26 * H ? 2 : 24;
  const xt: number[] = [];
  for (let t = Math.ceil(from / H) * H; t <= to; t += H) if (new Date(t).getHours() % every === 0) xt.push(t);

  // Tooltip: the time, the number running, the starts in the next sample, the top 5 groups, and the estimates.
  let tip: string[] | null = null;
  let hoverN = 0;
  if (hover) {
    const t = from + hover.i * step;
    hoverN = running[hover.i] ?? 0;
    const going = lr.filter((r) => r.start <= t && r.end > t);
    const g = new Map<string, number>();
    for (const r of going) g.set(groupOf(r.item), (g.get(groupOf(r.item)) ?? 0) + 1);
    const est = new Set(going.filter((r) => r.estimated).map((r) => r.item)).size;
    const topG = [...g.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    tip = [
      ...topG.map(([k, v]) => `${k}  ${fmtN(v)}`),
      ...(g.size > 5 ? [`+${g.size - 5} more groups`] : []),
      ...(est ? [`(runtimes estimated for ${est} jobs)`] : []),
    ];
  }

  const selList = useMemo(() => (sel ? runningIn(lr, sel.a, sel.b) : null), [lr, sel]);
  const startList = useMemo(
    () => (sel ? [] : items.map((it) => ({ it, f: startsOf(it, from, to) })).filter((x) => x.f.length).sort((a, b) => a.f[0] - b.f[0])),
    [items, from, to, sel],
  );

  let meta;
  let rows;
  let more = null;
  if (selList && sel) {
    meta = <><b>{fmtN(selList.length)}</b> jobs running between {when(sel.a)} and {when(sel.b)}</>;
    rows = selList.slice(0, CAP).map(({ item, runs: rs }) => (
      <ItemRow
        key={itemKey(item)}
        item={item}
        now={now}
        selected={selected}
        onSelect={onSelect}
        right={<span className="starts">{rs.slice(0, 2).map((r) => `${when(r.start)}–${hhmm(r.end)}`).join(' · ')}{rs.length > 2 ? ` +${rs.length - 2}` : ''}</span>}
      />
    ));
    if (selList.length > CAP) more = `+${fmtN(selList.length - CAP)} more — narrow the selection or filter by type, scope, tags or name`;
  } else {
    meta = <>{fmtN(startList.length)} scheduled to start in range, by first start</>;
    rows = startList.slice(0, CAP).map(({ it, f }) => (
      <ItemRow
        key={itemKey(it)}
        item={it}
        now={now}
        selected={selected}
        onSelect={onSelect}
        right={<span className="starts">⏱ {f.slice(0, 3).map(when).join(' · ')}{f.length > 3 ? ` +${f.length - 3}` : ''}</span>}
      />
    ));
    if (startList.length > CAP) more = `+${fmtN(startList.length - CAP)} more — drag across the chart or filter to narrow`;
  }

  return (
    <div className="list">
      <div className="list-meta"><span>{meta}</span><ViewSwitch view={view} onView={onView} /></div>
      {partial && <div className="partial">Partial list: {partial}.</div>}
      <div className="ld">
        <div className="ld-head">
          <b>Scheduled jobs running at once</b>
          <span>
            from each job&apos;s schedule and its typical runtime · peak <b>{fmtN(maxR)}</b> at {when(from + peak * step)} · {fmtN(scheduled)} scheduled items · {fmtN(lr.length)} runs in range
          </span>
          {sel
            ? <button type="button" className="ld-clear" onClick={() => setSel(null)}>clear selection ✕</button>
            : <span className="ld-hint">drag across the chart to list the jobs running then</span>}
        </div>
        <div className="ld-body">
          <div className="ld-y">
            {ticks.map((v) => <span key={v} style={{ bottom: `${(v / top) * 100}%` }}>{fmtN(v)}</span>)}
          </div>
          <div
            className="ld-plot"
            ref={plotRef}
            onMouseMove={(e) => setHover({ i: at(e.clientX).i, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHover(null)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            {ticks.map((v) => <div key={v} className="ld-grid" style={{ bottom: `${(v / top) * 100}%` }} />)}
            {xt.map((t) => <div key={t} className="ld-vgrid" style={{ left: `${pc(t)}%` }} />)}
            <svg viewBox={`0 0 ${W} ${HT}`} preserveAspectRatio="none">
              <polygon points={`0,${HT} ${pts} ${W},${HT}`} fill="#f8e4bd" />
              <polyline points={pts} fill="none" stroke="#c07a0c" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            {now >= from && now < to && <div className="ld-now" style={{ left: `${pc(now)}%` }}><span>now</span></div>}
            {sel && <div className="ld-sel" style={{ left: `${pc(sel.a)}%`, width: `${pc(sel.b) - pc(sel.a)}%` }} />}
            {drag && <div className="ld-drag" style={{ left: `${drag.lo * 100}%`, width: `${(drag.hi - drag.lo) * 100}%` }} />}
            {hover && <div className="ld-x" style={{ left: `${(hover.i / N) * 100}%` }}><i style={{ bottom: `${(hoverN / top) * 100}%` }} /></div>}
          </div>
        </div>
        <div className="ld-xa">
          {xt.map((t) => {
            const midnight = new Date(t).getHours() === 0;
            return <span key={t} className={midnight ? 'd' : ''} style={{ left: `${pc(t)}%` }}>{midnight ? dayName(t) : `${pad(new Date(t).getHours())}:00`}</span>;
          })}
        </div>
      </div>
      <div className="ld-list">
        {rows}
        {more && <div className="list-note">{more}</div>}
      </div>
      {hover && tip && (
        <div className="tip" ref={tipRef}>
          <b>{when(from + hover.i * step)}</b> · {fmtN(hoverN)} running · {fmtN(startsIn[Math.min(hover.i, N - 1)] ?? 0)} start in the next {step / 60e3} min
          {tip.map((line) => `\n${line}`).join('')}
        </div>
      )}
    </div>
  );
}
