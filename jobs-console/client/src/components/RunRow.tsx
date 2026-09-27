import { Fragment, type CSSProperties, type MouseEvent } from 'react';
import type { Run } from '../../../shared/domain/types';
import { dur, fmtStart } from '../../../shared/domain/format';
import {
  elapsedSec, progress, splitName, statBlock, taskStates,
} from '../model/rowView';
import { dayTime, durShort, visibleHistory } from '../model/history';
import './runrow.css';

const RESULT_LABEL = { succeeded: 'succeeded', failed: 'failed', cancelled: 'cancelled', partial: 'partially succeeded' } as const;

export type OpenHow = 'open' | 'stack' | 'tab';

export function RunRow({ run, history, nowMs, loadedAt, asOf, selected, onSelect, openRuns, onOpenRun, compact }: {
  run: Run;
  /** This job's finished runs inside the timeline window, oldest first (defaults to this run if finished). */
  history?: Run[];
  nowMs: number;
  loadedAt: number;
  asOf: number;
  selected?: boolean;
  onSelect?: (id: number) => void;
  /** Runs open in the drawer or comparison, marked on their history boxes. */
  openRuns?: readonly number[];
  /** A history box was clicked: open that run, or with Ctrl add it to the comparison here, or with Ctrl+Shift to the comparison tab. */
  onOpenRun?: (runId: number, rowId: number, how: OpenHow) => void;
  /** Name only, one line (C toggles), for scanning a long list quickly. */
  compact?: boolean;
}) {
  const elapsed = elapsedSec(run, nowMs, loadedAt);
  const { p, over } = progress(run, elapsed);
  const stat = statBlock(run, elapsed, asOf);
  const { prefix, rest } = splitName(run.name);
  const hist = visibleHistory(history ?? (run.result ? [run] : []));
  const openDrawer = (id: number) => (e: MouseEvent) => {
    e.stopPropagation();
    const how: OpenHow = e.ctrlKey || e.metaKey ? (e.shiftKey ? 'tab' : 'stack') : 'open';
    onOpenRun?.(id, run.id, how);
  };
  const isOpen = (id: number) => openRuns?.includes(id) ?? false;
  const nowDone = run.live ? taskStates(run, elapsed).filter((s) => s === 'ok').length : 0;
  const cls = ['rr', run.live && 'live', run.live && `bar-${run.type}`, run.live && over && 'over', selected && 'on'].filter(Boolean).join(' ');
  const style = run.live ? ({ '--p': String(p) } as CSSProperties) : undefined;

  if (compact) {
    return (
      <div className={`rr compact${selected ? ' on' : ''}`} data-id={run.id} onClick={onSelect ? () => onSelect(run.id) : undefined}>
        <span className="rr-name"><i>{prefix}</i>{rest}</span>
      </div>
    );
  }

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
        {run.live && (
          <div className="rr-prog">
            <span className="rr-bar"><b data-c="9">{stat.value}</b></span>
            {over && <span className="rr-avg" />}
          </div>
        )}
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
                className={`rh ${h.result ?? ''}${isOpen(h.id) ? ' pick' : ''}`}
                aria-label={`${fmtStart(h.startTime)}, ${RESULT_LABEL[h.result ?? 'failed']}, ${dur(h.durationSec)}`}
                aria-haspopup="dialog"
                onClick={openDrawer(h.id)}
              >
                <span className="rh-t">{durShort(h.durationSec)}</span>
                <span className="rh-w">{dayTime(h.startTime)}</span>
              </button>
            </span>
          ))}
          {run.live && (
            <span className="rh-wrap">
              <button
                type="button"
                className={`rh now ${run.type}${isOpen(run.id) ? ' pick' : ''}`}
                aria-label={`${fmtStart(run.startTime)}, running now`}
                aria-haspopup="dialog"
                onClick={openDrawer(run.id)}
                data-c="16"
              >
                <span className="rh-t">{nowDone} of {run.ntasks}</span>
                <span className="rh-w">{dayTime(run.startTime)}</span>
              </button>
            </span>
          )}
          {hist.shown.length === 0 && !run.live && <span className="rh-none">no finished runs in this window</span>}
        </div>
      </div>
    </div>
  );
}
