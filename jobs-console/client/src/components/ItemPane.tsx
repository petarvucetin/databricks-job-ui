import { useLayoutEffect, useRef } from 'react';
import type { Item, Run } from '../../../shared/domain/types';
import { dur, fmtStart } from '../../../shared/domain/format';
import { useItemDetail } from '../hooks/useItemDetail';
import { pillOf, runsFor, startsOf } from '../model/items';
import { dayTime, durShort } from '../model/history';
import { nextWhen } from '../model/schedule';
import { splitName } from '../model/rowView';
import { CopyButton } from './CopyButton';
import './runrow.css';

const RECENT = 30;
const RESULT_LABEL = { succeeded: 'succeeded', failed: 'failed', cancelled: 'cancelled', partial: 'partially succeeded' } as const;

const isSP = (s: string | undefined) => !!s && /^[0-9a-f-]{36}$/i.test(s);
/** "45m", "9h 44m", "3d". */
const spanIn = (ms: number) => {
  const m = Math.round(ms / 60e3);
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.round(m / 1440)}d`;
};

/** The job's tasks or the pipeline's facts, fetched on selection; loading and errors stay inside the section. */
function Structure({ item }: { item: Item }) {
  const d = useItemDetail(item.type, item.id);
  const job = item.type === 'job';
  const tasks = d.detail?.tasks ?? [];
  const pl = d.detail?.pipeline;
  return (
    <div className="p-sec">
      <h3>{job ? 'Tasks' : 'Pipeline'}{job && d.state === 'ready' && <span className="h-none">{tasks.length}</span>}</h3>
      {d.state === 'loading' && <span className="h-none">Loading…</span>}
      {d.state === 'error' && <span className="h-none">{d.message}</span>}
      {d.state === 'ready' && job && (
        tasks.length
          ? (
            <ul className="tasks">
              {tasks.map((t) => (
                <li key={t.key}>
                  <span className="tk">{t.key}<CopyButton value={t.key} label="task key" />{t.dependsOn.length > 0 && <span className="dep">after {t.dependsOn.join(', ')}</span>}</span>
                  <span className="tt">{t.type}</span>
                </li>
              ))}
            </ul>
          )
          : <span className="h-none">No tasks.</span>
      )}
      {d.state === 'ready' && !job && (
        pl
          ? (
            <dl className="facts">
              <dt>Kind</dt><dd>{pl.kind}</dd>
              <dt>Mode</dt><dd>{pl.continuous ? 'Continuous' : 'Triggered'}</dd>
              <dt>Target</dt><dd>{pl.target ? <><code>{pl.target}</code><CopyButton value={pl.target} label="target" /></> : '—'}</dd>
              <dt>Compute</dt><dd>{pl.serverless ? 'Serverless' : 'Classic cluster'}{pl.channel ? ` · channel ${pl.channel}` : ''}</dd>
            </dl>
          )
          : <span className="h-none">No pipeline spec.</span>
      )}
    </div>
  );
}

/** The detail pane: facts, recent runs (from the runs already loaded), tasks or pipeline facts, and See runs →. */
export function ItemPane({ item, runs, now, onClose, onSeeRuns, onOpenRun }: {
  item: Item;
  runs: Run[];
  now: number;
  onClose: () => void;
  onSeeRuns: (name: string) => void;
  onOpenRun: (runId: number) => void;
}) {
  const { prefix, rest: bare } = splitName(item.name);
  const recent = runsFor(item, runs).slice(-RECENT);
  const pill = pillOf(item, now);
  const next = startsOf(item, now, now + 8 * 24 * 3600e3)[0];
  const tags = Object.entries(item.tags);
  const boxesRef = useRef<HTMLDivElement>(null);
  const key = `${item.type}:${item.id}`;
  // Newest runs are on the right: open scrolled to them.
  useLayoutEffect(() => {
    const el = boxesRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [key]);

  return (
    <>
      <div className="p-head">
        <div className="p-top">
          <span className={`tag ${item.type}`}>{item.type === 'job' ? 'Job' : 'Pipeline'}</span>
          {item.url && <a className="p-open" href={item.url} target="_blank" rel="noreferrer">open in Databricks ↗</a>}
          <button type="button" className="p-x" title="Close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="p-name"><i>{prefix}</i>{bare}<CopyButton value={item.name} label="name" /></div>
        {item.description && <p className="p-desc">{item.description}</p>}
      </div>
      <div className="p-sec">
        <dl className="facts">
          <dt>Run as</dt><dd>{isSP(item.runAs) ? <>service principal <code>{item.runAs!.slice(0, 8)}…</code></> : (item.runAs ?? '—')}{item.runAs && <CopyButton value={item.runAs} label="run as" />}</dd>
          <dt>Creator</dt><dd>{item.creator ?? '—'}{item.creator && <CopyButton value={item.creator} label="creator" />}</dd>
          <dt>Trigger</dt>
          <dd title={pill.title}>
            {pill.text}
            {pill.cls === 'sched' && item.schedule && <span className="h-none"> · {item.schedule.tz} schedule</span>}
            {next !== undefined && <span className="h-none"> · next {nextWhen(next)}, in {spanIn(next - now)}</span>}
          </dd>
          <dt>Bundle</dt><dd>{item.bundle ? 'from a bundle' : 'not from a bundle'}</dd>
          <dt>Tags</dt><dd>{tags.length ? tags.map(([k, v]) => <span key={k} className="chip"><b>{k}:</b>{v}</span>) : '—'}</dd>
          <dt>{item.type === 'job' ? 'Job ID' : 'Pipeline ID'}</dt><dd><code>{item.id}</code><CopyButton value={String(item.id)} label={item.type === 'job' ? 'job ID' : 'pipeline ID'} /></dd>
        </dl>
      </div>
      <div className="p-sec">
        <h3>Recent runs <span className="h-none">click one to open it in Runs</span></h3>
        {recent.length
          ? (
            <div className="boxes" ref={boxesRef}>
              {recent.map((r) => r.live
                ? (
                  <button key={r.id} type="button" className={`rh now ${r.type}`} aria-label={`${fmtStart(r.startTime)}, ${r.kind === 'queued' ? 'queued' : 'running now'}`} onClick={() => onOpenRun(r.id)}>
                    <span className="rh-t">{r.kind === 'queued' ? 'queued' : durShort(Math.max(r.durationSec, (now - r.startTime) / 1e3))}</span>
                    <span className="rh-w">{dayTime(r.startTime)}</span>
                  </button>
                )
                : (
                  <button key={r.id} type="button" className={`rh ${r.result ?? ''}`} aria-label={`${fmtStart(r.startTime)}, ${RESULT_LABEL[r.result ?? 'failed']}, ${dur(r.durationSec)}`} onClick={() => onOpenRun(r.id)}>
                    <span className="rh-t">{durShort(r.durationSec)}</span>
                    <span className="rh-w">{dayTime(r.startTime)}</span>
                  </button>
                ))}
            </div>
          )
          : <span className="h-none">No runs in the loaded window.</span>}
      </div>
      <Structure key={key} item={item} />
      <div className="see"><button type="button" onClick={() => onSeeRuns(item.name)}>See runs →</button></div>
    </>
  );
}
