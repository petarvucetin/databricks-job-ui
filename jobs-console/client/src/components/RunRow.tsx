import type { CSSProperties } from 'react';
import type { Run } from '../../../shared/domain/types';
import {
  borderTone, chainSummary, elapsedSec, historyMarks, liveMessage, problemText, progress, splitName, statBlock, taskStates, taskText, whenText,
} from '../model/rowView';
import './runrow.css';

const CHAIN_CLASS = { ok: '', f: 'f', s: 's', r: 'r', p: 'q' } as const;

export function RunRow({ run, nowMs, loadedAt, asOf, selected, onSelect }: {
  run: Run;
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
  const msg = run.live ? liveMessage(run) : null;
  const task = taskText(run);
  const cls = ['rr', tone && `b-${tone}`, run.live && 'live', run.live && over && 'over', selected && 'on'].filter(Boolean).join(' ');
  const style = run.live ? ({ '--p': String(p) } as CSSProperties) : undefined;

  return (
    <div className={cls} style={style} data-id={run.id} onClick={onSelect ? () => onSelect(run.id) : undefined}>
      <div className="rr-lft">
        <div className="rr-l1">
          <span className={`rr-tag ${run.type}`} data-c="2">{run.type === 'pipeline' ? 'Pipeline' : 'Job'}</span>
          <span className="rr-name" data-c="3"><i>{prefix}</i>{rest}</span>
        </div>
        <div className="rr-l2">
          <span className="rr-ra" data-c="13">run as: <b>{run.runAs}</b></span>
          <span className="rr-hist" data-c="12">{historyMarks(run).map((m, i) => <i key={i} className={m} />)}</span>
        </div>
      </div>
      <div className="rr-mid">
        {run.live && (
          <>
            <div className="rr-chain" data-c="6">
              {taskStates(run).map((s, i) => <i key={i} className={CHAIN_CLASS[s]} />)}
              <em data-c="7">{chainSummary(run)}</em>
            </div>
            {msg && <div className={`rr-msg${msg.red ? ' red' : ''}`} data-c="8">{msg.lead} <span className="dim">{msg.dim}</span></div>}
          </>
        )}
        <div className="rr-park">
          <span className="pk">parked</span>
          <span className="rr-cause" data-c="4">{problemText(run)}</span>
          {task && <span className="rr-task" data-c="5">{task}</span>}
        </div>
      </div>
      <div className="rr-rgt">
        <span className="rr-when" data-c="10">{whenText(run)}</span>
        <div className="rr-st" data-c="11">
          <div className={stat.big ? 'rr-now' : undefined}>
            <span>{stat.label}</span>
            {stat.big ? <b data-c="9">{stat.value}</b> : <em data-c="9">{stat.value}</em>}
          </div>
          <div>
            <span>average</span>
            <em>{stat.average}</em>
          </div>
        </div>
      </div>
      {run.live && (
        <>
          <span className="rr-trk" />
          <span className="rr-bar" />
          {over && <span className="rr-avg" />}
        </>
      )}
    </div>
  );
}
