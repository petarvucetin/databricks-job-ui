import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { Item, Run } from '../../../shared/domain/types';
import { pad } from '../../../shared/domain/format';
import { isOnTimeline, itemKey, startsOf } from '../model/items';
import { fmtN, groupOf, isContinuous, loadCurve, loadRuns, niceTicks, runningIn } from '../model/load';
import { dayName, hhmm, when as whenAt, type SchedScale } from '../model/schedule';
import { ItemRow, ViewSwitch, type ItemsView } from './ItemList';

const H = 3600e3;
const CAP = 200;
const W = 1000;
const HT = 200;

type At = { f: number; i: number; t: number };

/**
 * Load view: jobs and pipelines expected to be running at once over the schedule window (from each schedule and its
 * typical runtime; credited pipelines from their jobs' starts; continuous pipelines the whole time), jobs at the bottom
 * and pipelines stacked on top, with a y-axis, a crosshair tooltip, and drag-to-select. The list under it shows what runs
 * in the selection, or the continuous pipelines and everything starting in range by first start; then the items not on
 * the chart (U2, U4). Ported from renderLoad() in the mockup.
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
  const { running, runningJobs, runningPipelines, startsIn } = useMemo(() => loadCurve(lr, from, to, step), [lr, from, to, step]);
  const contN = useMemo(() => lr.filter((r) => r.always).length, [lr]);
  const peak = useMemo(() => running.reduce((b, n, i) => (n > running[b] ? i : b), 0), [running]);
  const maxR = running[peak] ?? 0;
  const { ticks, top } = niceTicks(maxR);

  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  /** The hovered sample; the pointer position lives in `pointer` so moving within one sample renders nothing. */
  const [hover, setHover] = useState<{ i: number } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const hoverI = useRef<number | null>(null);
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

  // The tooltip follows the pointer and stays inside the window: placed through its ref, not state.
  const placeTip = () => {
    const tip = tipRef.current;
    if (!tip) return;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(pointer.current.x + 14, window.innerWidth - r.width - 8)}px`;
    tip.style.top = `${Math.min(pointer.current.y + 16, window.innerHeight - r.height - 8)}px`;
  };
  useLayoutEffect(placeTip, [hover]);
  const onMouseMove = (e: { clientX: number; clientY: number }) => {
    pointer.current = { x: e.clientX, y: e.clientY };
    const i = at(e.clientX).i;
    // Same sample: no state update at all, only the tooltip moves.
    if (hoverI.current !== i) {
      hoverI.current = i;
      setHover({ i });
    }
    placeTip();
  };

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
  // Jobs at the bottom, pipelines stacked on top (between the jobs line and the total); each band only when non-zero.
  const bands = useMemo(() => {
    const xy = (n: number, i: number) => `${(i / N) * W},${HT - (n / top) * HT}`;
    const ptsJ = runningJobs.map(xy);
    return {
      pts: running.map(xy).join(' '),
      ptsJ: ptsJ.join(' '),
      ptsJrev: [...ptsJ].reverse().join(' '),
      hasJ: runningJobs.some((n) => n > 0),
      hasP: runningPipelines.some((n) => n > 0),
    };
  }, [running, runningJobs, runningPipelines, N, top]);
  const every = span <= 7 * H ? 1 : span <= 26 * H ? 2 : 24;
  const xt: number[] = [];
  for (let t = Math.ceil(from / H) * H; t <= to; t += H) if (new Date(t).getHours() % every === 0) xt.push(t);

  // Tooltip: the time, the number running, the starts in the next sample, the top 5 groups, and the estimates.
  const hi = hover?.i ?? null;
  const hoverN = hi === null ? 0 : running[hi] ?? 0;
  const tip = useMemo(() => {
    if (hi === null) return null;
    const t = from + hi * step;
    const going = lr.filter((r) => r.start <= t && r.end > t);
    const g = new Map<string, number>();
    for (const r of going) g.set(groupOf(r.item), (g.get(groupOf(r.item)) ?? 0) + 1);
    const est = new Set(going.filter((r) => r.estimated).map((r) => r.item)).size;
    const topG = [...g.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return [
      ...topG.map(([k, v]) => `${k}  ${fmtN(v)}`),
      ...(g.size > 5 ? [`+${g.size - 5} more groups`] : []),
      ...(est ? [`(runtimes estimated for ${est} items)`] : []),
    ];
  }, [lr, hi, from, step]);
  const hoverJ = hi === null ? 0 : runningJobs[hi] ?? 0;
  const hoverP = hi === null ? 0 : runningPipelines[hi] ?? 0;

  const selList = useMemo(() => (sel ? runningIn(lr, sel.a, sel.b) : null), [lr, sel]);
  const startList = useMemo(
    () => (sel ? [] : items.filter((it) => !isContinuous(it)).map((it) => ({ it, f: startsOf(it, from, to) })).filter((x) => x.f.length).sort((a, b) => a.f[0] - b.f[0])),
    [items, from, to, sel],
  );
  const cont = useMemo(() => items.filter(isContinuous), [items]);
  // Not on the chart: no fixed start times, and not continuous.
  const off = useMemo(() => items.filter((it) => !isOnTimeline(it) && !isContinuous(it)), [items]);
  const onChart = lr.length > 0;

  // Memoized so hovering the chart (which re-renders this view) leaves the rows alone.
  const { meta, rows, more, offRows } = useMemo(() => {
    const when = (t: number) => whenAt(t, scale);
    const row = (it: Item, right: ReactNode) => <ItemRow key={itemKey(it)} item={it} now={now} selected={selected} onSelect={onSelect} right={right} />;
    const whole = <span className="ld-offr">running the whole time</span>;
    const offRows = off.length ? (
      <>
        <div className="ld-off">Not on the chart · {fmtN(off.length)} with no fixed start times (manual, triggered by a file or a table, paused, or a pipeline no scheduled job starts)</div>
        {off.slice(0, CAP).map((it) => row(it, <span className="ld-offr">no start times</span>))}
        {off.length > CAP && <div className="list-note">+{fmtN(off.length - CAP)} more</div>}
      </>
    ) : null;
    if (selList && sel) {
      return {
        meta: <><b>{fmtN(selList.length)}</b> jobs and pipelines running between {when(sel.a)} and {when(sel.b)}</>,
        rows: selList.slice(0, CAP).map(({ item, runs: rs }) => row(item, rs[0].always ? whole : (
          <span className="starts">{rs.slice(0, 2).map((r) => `${when(r.start)}–${hhmm(r.end)}`).join(' · ')}{rs.length > 2 ? ` +${rs.length - 2}` : ''}</span>
        ))),
        more: selList.length > CAP ? `+${fmtN(selList.length - CAP)} more — narrow the selection or filter by type, scope, tags or name` : null,
        offRows,
      };
    }
    const empty = !onChart && off.length ? ' · nothing here has fixed start times, so the chart is empty' : '';
    return {
      meta: startList.length
        ? <>{fmtN(startList.length)} scheduled to start in range, by first start{cont.length ? ` · ${fmtN(cont.length)} continuous` : ''}{empty}</>
        : <>{cont.length ? `${fmtN(cont.length)} continuous on the chart` : 'Nothing on the chart'}{empty}</>,
      rows: [
        ...cont.map((it) => row(it, whole)),
        ...startList.slice(0, CAP).map(({ it, f }) => row(it, <span className="starts">⏱ {f.slice(0, 3).map(when).join(' · ')}{f.length > 3 ? ` +${f.length - 3}` : ''}</span>)),
      ],
      more: startList.length > CAP ? `+${fmtN(startList.length - CAP)} more — drag across the chart or filter to narrow` : null,
      offRows,
    };
  }, [selList, sel, startList, cont, off, onChart, scale, now, selected, onSelect]);

  return (
    <div className="list">
      <div className="list-meta"><span>{meta}</span><ViewSwitch view={view} onView={onView} /></div>
      {partial && <div className="partial">Partial list: {partial}.</div>}
      <div className="ld">
        <div className="ld-head">
          <b>Running at once</b>
          <span className="ld-key"><i className="kj" />jobs <i className="kp" />pipelines</span>
          <span>
            from schedules and typical runtimes · pipelines count when a scheduled job starts them{contN ? `, continuous ones (${fmtN(contN)}) run the whole time` : ''} · {onChart ? <>peak <b>{fmtN(maxR)}</b> at {when(from + peak * step)}</> : 'Nothing on the chart'}
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
            onMouseMove={onMouseMove}
            onMouseLeave={() => {
              hoverI.current = null;
              setHover(null);
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            {ticks.map((v) => <div key={v} className="ld-grid" style={{ bottom: `${(v / top) * 100}%` }} />)}
            {xt.map((t) => <div key={t} className="ld-vgrid" style={{ left: `${pc(t)}%` }} />)}
            <svg viewBox={`0 0 ${W} ${HT}`} preserveAspectRatio="none">
              {bands.hasJ && <polygon points={`0,${HT} ${bands.ptsJ} ${W},${HT}`} fill="#eadfce" />}
              {bands.hasP && <polygon points={`${bands.pts} ${bands.ptsJrev}`} fill="#ddd3f3" />}
              {bands.hasJ && <polyline points={bands.ptsJ} fill="none" stroke="#9c8462" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
              {bands.hasP && <polyline points={bands.pts} fill="none" stroke="#6a4fb0" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            </svg>
            {now >= from && now < to && <div className="ld-now" style={{ left: `${pc(now)}%` }}><span>now</span></div>}
            {sel && <div className="ld-sel" style={{ left: `${pc(sel.a)}%`, width: `${pc(sel.b) - pc(sel.a)}%` }} />}
            {drag && <div className="ld-drag" style={{ left: `${drag.lo * 100}%`, width: `${(drag.hi - drag.lo) * 100}%` }} />}
            {hi !== null && <div className="ld-x" style={{ left: `${(hi / N) * 100}%` }}><i style={{ bottom: `${(hoverN / top) * 100}%` }} /></div>}
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
        {offRows}
      </div>
      {hi !== null && tip && (
        <div className="tip" ref={tipRef}>
          <b>{when(from + hi * step)}</b> · {fmtN(hoverN)} running: {fmtN(hoverJ)} jobs · {fmtN(hoverP)} pipelines · {fmtN(startsIn[Math.min(hi, N - 1)] ?? 0)} start in the next {step / 60e3} min
          {tip.map((line) => `\n${line}`).join('')}
        </div>
      )}
    </div>
  );
}
