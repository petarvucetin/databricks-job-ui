import { Fragment, useState, type CSSProperties, type MouseEvent } from 'react';
import type { Run } from '../../../shared/domain/types';
import { dur, fmtStart } from '../../../shared/domain/format';
import {
  borderTone, chainSummary, elapsedSec, progress, splitName, statBlock, taskNames, taskStates,
} from '../model/rowView';
import { dayTime, durShort, visibleHistory } from '../model/history';
import './runrow.css';

const CHAIN_CLASS = { ok: '', f: 'f', s: 's', r: 'r', p: 'q' } as const;
const RESULT_LABEL = { succeeded: 'succeeded', failed: 'failed', cancelled: 'cancelled', partial: 'partially succeeded' } as const;

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
  // Which run's task chain is open: a running row starts on its current run; clicking a history box opens that run, clicking it again closes.
  const [picked, setPicked] = useState<number | null>(run.live ? run.id : null);
  const [hover, setHover] = useState<number | null>(null);
  const chainRun = picked === null ? null : picked === run.id && run.live ? run : hist.shown.find((h) => h.id === picked) ?? null;
  const chainElapsed = chainRun === run ? elapsed : chainRun?.durationSec;
  const chain = chainRun ? taskStates(chainRun, chainElapsed) : [];
  const names = chainRun ? taskNames(chainRun) : [];
  const pick = (id: number) => (e: MouseEvent) => {
    e.stopPropagation();
    setHover(null);
    setPicked((p) => (p === id ? null : id));
  };
  const nowStates = run.live ? taskStates(run, elapsed) : [];
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
        {chainRun && (
          <>
            <div className="rr-chain" data-c="6" onMouseLeave={() => setHover(null)}>
              {chain.map((s, i) => <i key={i} className={`${CHAIN_CLASS[s]}${hover === i ? ' hov' : ''}`} onMouseEnter={() => setHover(i)} />)}
              <em data-c="7">{chainSummary(chainRun, chainElapsed)}</em>
            </div>
            <div className="rr-task" data-c="15">{hover !== null && names[hover] ? names[hover] : ' '}</div>
          </>
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
            <button
              type="button"
              key={h.id}
              className={`rh ${h.result ?? ''}${h.id === run.id ? ' cur' : ''}${h.id === picked ? ' pick' : ''}`}
              title={`${fmtStart(h.startTime)}, ${RESULT_LABEL[h.result ?? 'failed']}, ${dur(h.durationSec)}`}
              onClick={pick(h.id)}
            >
              <span className="rh-t">{durShort(h.durationSec)}</span>
              <span className="rh-w">{dayTime(h.startTime)}</span>
            </button>
          ))}
          {run.live && (
            <button
              type="button"
              className={`rh now ${run.type} cur${picked === run.id ? ' pick' : ''}`}
              title={`${fmtStart(run.startTime)}, running now`}
              onClick={pick(run.id)}
              data-c="16"
            >
              <span className="rh-t">{nowStates.filter((s) => s === 'ok').length} of {run.ntasks}</span>
              <span className="rh-w">{dayTime(run.startTime)}</span>
            </button>
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
