import { Fragment, useState, type MouseEvent } from 'react';
import type { Run } from '../../../shared/domain/types';
import { dur, fmtStart } from '../../../shared/domain/format';
import {
  elapsedSec, progress, splitName, statBlock, taskStates,
} from '../model/rowView';
import { dayTime, durShort, visibleHistory } from '../model/history';
import { TitleLink } from './TitleLink';
import './runrow.css';

const RESULT_LABEL = { succeeded: 'succeeded', failed: 'failed', cancelled: 'cancelled', partial: 'partially succeeded' } as const;

/** Two chasing arrows, turning while the run is going. */
function Spinner() {
  return (
    <svg className="rr-spin" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.5 8A5.5 5.5 0 0 1 4.1 11.9M4.1 14.1V11.9H6.3" />
      <path d="M2.5 8A5.5 5.5 0 0 1 11.9 4.1M9.7 4.1H11.9V1.9" />
    </svg>
  );
}

export type OpenHow = 'open' | 'stack' | 'tab';

export function RunRow({ run, history, nowMs, loadedAt, asOf, selected, onSelect, openRuns, onOpenRun, compact, historyOpen = false }: {
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
  /** Run history boxes start hidden; the Run history title shows and hides them. */
  historyOpen?: boolean;
}) {
  const [showHist, setShowHist] = useState(historyOpen);
  const elapsed = elapsedSec(run, nowMs, loadedAt);
  const { over } = progress(run, elapsed);
  const stat = statBlock(run, elapsed, asOf);
  const { prefix, rest } = splitName(run.name);
  // "[dev john smith] " → kind "dev", who "john smith"
  const inner = prefix.trim().slice(1, -1);
  const target = inner ? { kind: inner.split(' ')[0], who: inner.split(' ').slice(1).join(' ') } : null;
  const hist = visibleHistory(history ?? (run.result ? [run] : []));
  const openDrawer = (id: number) => (e: MouseEvent) => {
    e.stopPropagation();
    const how: OpenHow = e.ctrlKey || e.metaKey ? (e.shiftKey ? 'tab' : 'stack') : 'open';
    onOpenRun?.(id, run.id, how);
  };
  const isOpen = (id: number) => openRuns?.includes(id) ?? false;
  const nowDone = run.live ? taskStates(run, elapsed).filter((s) => s === 'ok').length : 0;
  const cls = ['rr', run.live && 'live', run.live && over && 'over', showHist && 'hist-open', selected && 'on'].filter(Boolean).join(' ');
  const nRuns = hist.shown.length + hist.earlier + (run.live ? 1 : 0);

  if (compact) {
    return (
      <div className={`rr compact${selected ? ' on' : ''}`} data-id={run.id} onClick={onSelect ? () => onSelect(run.id) : undefined}>
        <span className="rr-name"><i>{prefix}</i>{rest}</span>
      </div>
    );
  }

  return (
    <div className={cls} data-id={run.id} onClick={onSelect ? () => onSelect(run.id) : undefined}>
      <div className="rr-l1">
        <span className={`rr-tag ${run.type}`} data-c="2">{run.type === 'pipeline' ? 'Pipeline' : 'Job'}</span>
        <span className="rr-ra" data-c="13">run as <b>{run.runAs}</b></span>
        {stat.label === 'waiting' && (
          <span className="rr-st" data-c="11">
            <span>{stat.label}</span>
            <b data-c="9">{stat.value}</b>
          </span>
        )}
        <span className="rr-name" data-c="3"><TitleLink url={run.url}>{rest.split('_').map((part, i) => (i ? <Fragment key={i}>_<wbr />{part}</Fragment> : part))}</TitleLink></span>
      </div>
      {run.live && (
        <div className="rr-run" data-c="9">
          <span className="rr-run-s"><Spinner /></span>
          <b>{stat.value}</b>
        </div>
      )}
      {run.live && over && <span className="rr-run-avg"><em>+{dur(elapsed - run.usualSec)}</em> over</span>}
      <div className="rr-main">
        {target && <span className="rr-tgt" data-c="19">{target.kind} <b>{target.who}</b></span>}
      </div>
      <div className="rr-hist" data-c="12">
        <button
          type="button"
          className="rr-hist-t"
          aria-expanded={showHist}
          onClick={(e) => {
            e.stopPropagation();
            setShowHist((v) => !v);
          }}
        >
          <span className="rr-chev" aria-hidden="true">{showHist ? '▾' : '▸'}</span>
          <span>Run history</span>
          <span className="rr-n">{nRuns}</span>
          <span className="rr-avg-t" data-c="14">average <em>{stat.average}</em></span>
        </button>
        {showHist && <div className="rr-hist-boxes">
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
        </div>}
      </div>
    </div>
  );
}
