import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { Run } from '../../../shared/domain/types';
import { dur, fmtStart } from '../../../shared/domain/format';
import {
  borderTone, chainSummary, elapsedSec, progress, splitName, statBlock, taskNames, taskStates,
} from '../model/rowView';
import { dayTime, durShort, visibleHistory } from '../model/history';
import './runrow.css';

const CHAIN_CLASS = { ok: '', f: 'f', s: 's', r: 'r', p: 'q' } as const;
const RESULT_LABEL = { succeeded: 'succeeded', failed: 'failed', cancelled: 'cancelled', partial: 'partially succeeded' } as const;

/** One square per task plus the counted summary; hovering a square shows only its task name, on the line below (or above, in the popup). */
function TaskChain({ run, elapsed, labels, nameAbove }: { run: Run; elapsed: number; labels?: boolean; nameAbove?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const states = taskStates(run, elapsed);
  const names = taskNames(run);
  const summary = chainSummary(run, elapsed);
  const name = <div className="rr-task" data-c={labels ? '15' : undefined}>{hover !== null && names[hover] ? names[hover] : ' '}</div>;
  return (
    <>
      {nameAbove && name}
      <div className="rr-chain" data-c={labels ? '6' : undefined} onMouseLeave={() => setHover(null)}>
        {states.map((s, i) => <i key={i} className={`${CHAIN_CLASS[s]}${hover === i ? ' hov' : ''}`} onMouseEnter={() => setHover(i)} />)}
        {summary !== 'all ok' && <em data-c={labels ? '7' : undefined}>{summary}</em>}
      </div>
      {!nameAbove && name}
    </>
  );
}

/** Popup under a history box with that run's task boxes; closes on Escape, a click outside, or the box again. */
function RunPopup({ run, elapsed, live, onClose }: { run: Run; elapsed: number; live: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the popup on screen: slide it left when it would run past the right edge.
  useLayoutEffect(() => {
    const el = ref.current;
    const r = el?.getBoundingClientRect();
    const limit = document.documentElement.clientWidth - 12;
    if (el && r && r.right > limit) el.style.left = `${limit - r.right}px`;
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !ref.current?.parentElement?.contains(t)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="rh-pop" role="dialog" aria-label="Run tasks" data-c="17" onClick={(e) => e.stopPropagation()}>
      <div className="rh-pop-t">
        <span>{fmtStart(run.startTime)}</span>
        <span className={`rh-pop-r ${live ? 'now' : run.result ?? ''}`}>{live ? 'running now' : RESULT_LABEL[run.result ?? 'failed']}</span>
        <span>{dur(elapsed)}</span>
        <button type="button" className="rh-pop-x" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <TaskChain run={run} elapsed={elapsed} nameAbove />
    </div>
  );
}

export function RunRow({ run, history, nowMs, loadedAt, asOf, selected, onSelect }: {
  run: Run;
  /** This job's finished runs inside the timeline window, oldest first (defaults to this run if finished). */
  history?: Run[];
  nowMs: number;
  loadedAt: number;
  asOf: number;
  selected?: boolean;
  onSelect?: (id: number) => void;
}) {
  const elapsed = elapsedSec(run, nowMs, loadedAt);
  const { p, over } = progress(run, elapsed);
  const tone = borderTone(run);
  const stat = statBlock(run, elapsed, asOf);
  const { prefix, rest } = splitName(run.name);
  const hist = visibleHistory(history ?? (run.result ? [run] : []));
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const toggle = (id: number) => (e: MouseEvent) => {
    e.stopPropagation();
    setOpen((o) => (o === id ? null : id));
  };
  const nowDone = run.live ? taskStates(run, elapsed).filter((s) => s === 'ok').length : 0;
  const cls = ['rr', tone && `b-${tone}`, run.live && 'live', run.live && `bar-${run.type}`, run.live && over && 'over', selected && 'on'].filter(Boolean).join(' ');
  const style = run.live ? ({ '--p': String(p) } as CSSProperties) : undefined;

  return (
    <div className={cls} style={style} data-id={run.id} onClick={onSelect ? () => onSelect(run.id) : undefined}>
      <div className="rr-main">
        <div className="rr-l1">
          <span className={`rr-tag ${run.type}`} data-c="2">{run.type === 'pipeline' ? 'Pipeline' : 'Job'}</span>
          <span className="rr-ra" data-c="13">run as <b>{run.runAs}</b></span>
          {stat.label === 'waiting' && (
            <span className="rr-st" data-c="11">
              <span>{stat.label}</span>
              <b data-c="9">{stat.value}</b>
            </span>
          )}
        </div>
        <span className="rr-name" data-c="3"><i>{prefix}</i>{rest.split('_').map((part, i) => (i ? <Fragment key={i}>_<wbr />{part}</Fragment> : part))}</span>
        {run.live && <TaskChain run={run} elapsed={elapsed} labels />}
      </div>
      <div className="rr-hist" data-c="12">
        <div className="rr-hist-t">
          <span>Run history</span>
          <span className="rr-avg-t" data-c="14">average <em>{stat.average}</em></span>
        </div>
        <div className="rr-hist-boxes">
          {hist.earlier > 0 && <span className="rh-more">+{hist.earlier} earlier</span>}
          {hist.shown.map((h) => (
            <span key={h.id} className="rh-wrap">
              <button
                type="button"
                className={`rh ${h.result ?? ''}${h.id === open ? ' pick' : ''}`}
                aria-label={`${fmtStart(h.startTime)}, ${RESULT_LABEL[h.result ?? 'failed']}, ${dur(h.durationSec)}`}
                aria-expanded={h.id === open}
                onClick={toggle(h.id)}
              >
                <span className="rh-t">{durShort(h.durationSec)}</span>
                <span className="rh-w">{dayTime(h.startTime)}</span>
              </button>
              {h.id === open && <RunPopup run={h} elapsed={h.durationSec} live={false} onClose={close} />}
            </span>
          ))}
          {run.live && (
            <span className="rh-wrap">
              <button
                type="button"
                className={`rh now ${run.type}${open === run.id ? ' pick' : ''}`}
                aria-label={`${fmtStart(run.startTime)}, running now`}
                aria-expanded={open === run.id}
                onClick={toggle(run.id)}
                data-c="16"
              >
                <span className="rh-t">{nowDone} of {run.ntasks}</span>
                <span className="rh-w">{dayTime(run.startTime)}</span>
              </button>
              {open === run.id && <RunPopup run={run} elapsed={elapsed} live onClose={close} />}
            </span>
          )}
          {hist.shown.length === 0 && !run.live && <span className="rh-none">no finished runs in this window</span>}
        </div>
      </div>
      {run.live && (
        <>
          <span className="rr-trk" />
          <span className="rr-bar"><b data-c="9">{stat.value}</b></span>
          {over && <span className="rr-avg" />}
        </>
      )}
    </div>
  );
}
