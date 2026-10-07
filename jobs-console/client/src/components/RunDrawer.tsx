import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Run } from '../../../shared/domain/types';
import { hasAnsi, parseAnsi, stripAnsi, type AnsiSegment, type AnsiStyle } from '../../../shared/domain/ansi';
import { dur, durLive, fmtStart } from '../../../shared/domain/format';
import { elapsedSec, runningIndex, splitName, taskStates } from '../model/rowView';
import { causeGroups, lastRunSec, schedule, spanSec, tasksHead, ticks, type ScheduledTask } from '../model/runDetail';
import { useTaskLog } from '../hooks/useTaskLog';
import { useTabActiveRef } from '../hooks/useTabActive';
import { TitleLink } from './TitleLink';
import './drawer.css';

const RESULT_ROOT = { succeeded: 'Succeeded', failed: 'Failed', cancelled: 'Cancelled', partial: 'Partially succeeded' } as const;
const GRID_CLASS = { ok: '', f: 'f', s: 's', r: 'r', p: 's' } as const;

function Glyph({ type }: { type: Run['type'] }) {
  return (
    <span className="ty" title={type === 'pipeline' ? 'Pipeline' : 'Job'}>
      {type === 'pipeline' ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M1.5 4h5.5c2 0 2.5 4 4.5 4h3" /><path d="M1.5 12h5.5c2 0 2.5-4 4.5-4" /><path d="M12.5 6l2 2-2 2" /></svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="2" width="5" height="4" rx="1" /><rect x="9.5" y="10" width="5" height="4" rx="1" /><path d="M4 6v3.5a2 2 0 0 0 2 2h3.5" /></svg>
      )}
    </span>
  );
}

/** One stop on the route: a pill, a value, an optional right-hand pill; the header toggles the body. */
function Panel({ k, v, r, cls = '', mono, open: initial = false, children }: {
  k: string; v: ReactNode; r?: string; cls?: '' | 'fail' | 'last'; mono?: boolean; open?: boolean; children?: ReactNode;
}) {
  const [open, setOpen] = useState(initial);
  const hasBody = children !== undefined && children !== null && children !== false;
  return (
    <div className={`panel ${cls}${open && hasBody ? ' open' : ''}`}>
      <div className="hd" onClick={hasBody ? () => setOpen((o) => !o) : undefined}>
        <span className={`k pill${cls === 'fail' ? ' red' : ''}`}>{k}</span>
        <span className={`v${mono ? ' mono' : ''}`}>{v}</span>
        {r && <span className={`r pill${/cause/.test(r) ? ' amber' : ''}`}>{r}</span>}
        <span className="chev">{open && hasBody ? '▾' : '▸'}</span>
      </div>
      {hasBody && <div className="bd">{children}</div>}
    </div>
  );
}

/** Below this share of the axis the duration label goes after the bar instead of inside it. */
const LABEL_INSIDE_PCT = 14;

/** A task bar as long as the task ran on the time axis (to now while running); the label sits inside when it fits. */
function Bar({ t, run, total, sel }: { t: ScheduledTask; run: Run; total: number; sel: boolean }) {
  const startPct = (100 * t.start) / total;
  const left = `${startPct}%`;
  if (t.state === 'p') return <span className="sq s" style={{ left }}>not started</span>;
  if (t.state === 's') return <span className={`sq s${sel ? ' sel' : ''}`} style={{ left }}>skipped</span>;
  // Mock data only: the prototype's picture of a retried task (earlier attempts as hatched boxes).
  if (!run.tasks && t.state === 'r' && run.kind === 'retrying') {
    return (
      <>
        <span className="sq fa" style={{ left }}>48m 22s</span>
        <span className="sq fa" style={{ left: `calc(${left} + 66px)` }}>38m 29s</span>
        <span className="sq r" style={{ left: `calc(${left} + 132px)` }}>{dur(t.dur)}</span>
      </>
    );
  }
  const running = t.state === 'r';
  const secs = running ? Math.max(t.dur, total - t.start) : t.dur;
  const widthPct = Math.min(100 - startPct, (100 * secs) / total);
  const retry = t.attempt ? `attempt ${t.attempt + 1}` : '';
  const label = [running ? (retry ? `retrying, ${retry}` : 'running') : dur(t.dur), t.state === 'f' ? 'failed' : '', !running ? retry : ''].filter(Boolean).join(', ');
  const cls = running ? ' r' : t.state === 'f' ? ' f' : '';
  const inside = widthPct >= LABEL_INSIDE_PCT;
  return (
    <>
      <span className={`sq bar${cls}${sel ? ' sel' : ''}`} style={{ left, width: `${widthPct}%` }}>
        {inside ? label : ''}
      </span>
      {!inside && <span className={`sq-after${cls}`} style={{ left: `calc(${startPct + widthPct}% + 6px)` }}>{label}</span>}
    </>
  );
}

/** Tasks on a time axis; an elbow arrow runs from each task to the one that waits on it. */
function Gantt({ run, rows, total, isSel, onPick }: {
  run: Run; rows: ScheduledTask[]; total: number; isSel: (t: ScheduledTask) => boolean; onPick: (t: ScheduledTask) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<{ w: number; h: number; paths: { d: string; f: boolean }[] }>({ w: 0, h: 0, paths: [] });
  // Arrows follow the laid-out bars, so measure after every render; the equality check below stops the update loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const g = ref.current;
    if (!g) return;
    const gr = g.getBoundingClientRect();
    const bars = new Map<string, HTMLElement>();
    g.querySelectorAll<HTMLElement>('.grow[data-i]').forEach((el) => {
      const sq = el.querySelector<HTMLElement>('.sq');
      if (sq && el.dataset.i) bars.set(el.dataset.i, sq);
    });
    const paths: { d: string; f: boolean }[] = [];
    for (const t of rows) {
      const b = bars.get(String(t.i));
      for (const dep of t.deps) {
        const a = bars.get(String(dep));
        if (!a || !b) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const x1 = ra.left - gr.left + g.scrollLeft + 1;
        const y1 = ra.bottom - gr.top;
        const y2 = rb.top - gr.top + rb.height / 2;
        const bl = rb.left - gr.left + g.scrollLeft;
        const x2 = bl >= x1 ? bl - 1 : rb.right - gr.left + g.scrollLeft + 1;
        paths.push({ d: `M${x1},${y1} V${y2} H${x2}`, f: b.classList.contains('f') });
      }
    }
    const next = { w: g.scrollWidth, h: g.scrollHeight, paths };
    setLinks((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });
  return (
    <div className="gantt" ref={ref}>
      <div className="axis">
        <div />
        <div className="ticks">
          {ticks(total).map((label, k) => <span key={k} style={{ left: `${k * 25}%` }}>{label}</span>)}
        </div>
      </div>
      {rows.map((t) => {
        const sel = isSel(t);
        return (
          <div key={t.i} className={`grow${sel ? ' sel' : ''}`} data-i={t.i} onClick={() => onPick(t)}>
            <div className="lbl" data-full={t.name}><span>{t.name}</span></div>
            <div className="trk"><Bar t={t} run={run} total={total} sel={sel} /></div>
          </div>
        );
      })}
      <svg className="links" width={links.w} height={links.h}>
        <defs>
          <marker id="dr-arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#b9ab99" /></marker>
          <marker id="dr-arrf" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#d6452f" /></marker>
        </defs>
        {links.paths.map((p, k) => <path key={k} d={p.d} className={p.f ? 'f' : undefined} markerEnd={p.f ? 'url(#dr-arrf)' : 'url(#dr-arr)'} />)}
      </svg>
    </div>
  );
}

function LogLine({ line }: { line: string }) {
  const cls = /ERROR|Traceback|Exception|failed:/.test(line) ? 'err' : /WARN/.test(line) ? 'warn' : /complete|done$/.test(line) ? 'ok' : '';
  const m = /^(\d\d:\d\d:\d\d) (.*)$/.exec(line);
  const rest = m ? (m[2] ?? '') : line;
  const body = (
    <>
      {m && <><span className="ts">{m[1]}</span> </>}
      {rest.split(/(\[[A-Za-z_]+\])/).map((part, i) => (i % 2 ? <span key={i} className="tag">{part}</span> : part))}
    </>
  );
  return cls ? <span className={cls}>{body}</span> : body;
}

/** One log line written with ANSI colours (e.g. an IPython traceback from Databricks), in the terminal's own colours. */
function AnsiLine({ segments }: { segments: AnsiSegment[] }) {
  return (
    <>
      {segments.map((s, i) => {
        const style: CSSProperties = {};
        if (s.fg) style.color = s.fg;
        if (s.bg) style.background = s.bg;
        if (s.bold) style.fontWeight = 600;
        if (s.italic) style.fontStyle = 'italic';
        if (s.underline) style.textDecoration = 'underline';
        return Object.keys(style).length ? <span key={i} style={style}>{s.text}</span> : s.text;
      })}
    </>
  );
}

/** Log lines, CRs dropped; lines with ANSI escapes parsed into styled segments, carrying style across lines like a terminal. */
function logLines(text: string): { plain: string; segments?: AnsiSegment[] }[] {
  let carry: AnsiStyle = {};
  return text.split('\n').map((raw) => {
    const line = raw.replace(/\r/g, '');
    if (!hasAnsi(line) && !Object.keys(carry).length) return { plain: line };
    const { segments, end } = parseAnsi(line, carry);
    carry = end;
    return { plain: stripAnsi(line), segments };
  });
}

function TaskLog({ runId, task, hint, failed, nonce, url }: { runId: number; task: string; hint?: string; failed: boolean; nonce: number; url?: string }) {
  const log = useTaskLog(runId, task, hint, nonce);
  const ref = useRef<HTMLDivElement>(null);
  const text = log.state === 'ready' ? log.text : '';
  const lines = useMemo(() => (text ? logLines(text) : []), [text]);
  useLayoutEffect(() => {
    if (failed && log.state === 'ready' && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [failed, log.state]);
  return (
    <>
      <div className="logh">
        <b>Log</b>
        <span>{log.state === 'loading' ? 'loading' : log.state === 'error' ? 'not available' : `${lines.length} lines${failed ? ', ends at the error' : ''}`}</span>
        {url && <a className="r" href={url} target="_blank" rel="noopener noreferrer" title="Open this run in Databricks for the full output and driver logs">open full log ↗</a>}
      </div>
      <div className="log" ref={ref}>
        {log.state === 'error' ? 'log not available' : lines.map((l, i) => <div key={i}>{l.segments ? <AnsiLine segments={l.segments} /> : <LogLine line={l.plain} />}</div>)}
      </div>
    </>
  );
}

function TaskBody({ run, task, kind, compute = 'ingest_cluster, 15.4 LTS, i4i.2xlarge, 2 to 10 workers, spot', ext = '.py' }: {
  run: Run; task: string; kind: string; compute?: string; ext?: string;
}) {
  const params = Object.entries(run.params).map(([k, v]) => `${k}=${v}`).join('  ');
  if (run.tasks) {
    return (
      <>
        {params ? <div className="kv"><span>parameters</span><span className="mono">{params}</span></div> : null}
      </>
    );
  }
  return (
    <>
      <div className="kv">
        <span>source</span><a href="#" className="path" onClick={(e) => e.preventDefault()}>/Workspace/Repos/finance-gl/src/gl/{task}{ext}</a>
        <span>parameters</span><span className="mono">{params}</span>
        <span>compute</span><span>{compute}</span>
        {kind === 'Python script' && <><span>cluster</span><span className="mono">0918-0600-gl4x</span></>}
      </div>
    </>
  );
}

/** The drawer run's own refresh: how it is going and when its data was loaded (see useRunRefresh). */
export interface DrawerRefresh {
  onRefresh: () => Promise<void>;
  refreshing: boolean;
  error: string | null;
  updatedAt: number;
}

const agoText = (sec: number) => (sec < 60 ? `updated ${sec}s ago` : `updated ${Math.floor(sec / 60)}m ago`);

/**
 * Side drawer for one run, ported from the prototype (`prototype/drawer.html`); Escape, the scrim or × closes it.
 * ↻ refreshes the run and its open task log. While the run is live, the log also refetches whenever the page's data
 * refreshes (`loadedAt` changes); a finished run's log is fetched once.
 */
export function RunDrawer({ run, history, nowMs, loadedAt, onClose, refresh }: {
  run: Run; history?: Run[]; nowMs: number; loadedAt: number; onClose: () => void; refresh?: DrawerRefresh;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<'timeline' | 'grid'>('timeline');
  const [selTask, setSelTask] = useState(0);
  const [selIdx, setSelIdx] = useState<number | null>(null);
  // Log refetches: one per page refresh while the run is live (and the one that sees it finish), one per ↻.
  const [auto, setAuto] = useState({ loadedAt, live: run.live, n: 0 });
  if (auto.loadedAt !== loadedAt) setAuto({ loadedAt, live: run.live, n: auto.live || run.live ? auto.n + 1 : auto.n });
  const [manual, setManual] = useState(0);
  const logNonce = auto.n + manual;
  const onRefresh = refresh?.onRefresh;
  const refreshNow = () => {
    if (onRefresh) void onRefresh().finally(() => setManual((n) => n + 1));
  };
  // A failed pipeline task in the list only says to see the pipeline's logs (FailedTask.pipeline 'unread'); the run's own refresh reads the pipeline's
  // events for the real cause. Once per run opened, so a pipeline that cannot be read is not asked again and again.
  const pipelineAsked = useRef<number | null>(null);
  const needsPipelineCause = run.failed.some((f) => f.pipeline === 'unread');
  useEffect(() => {
    if (!needsPipelineCause || pipelineAsked.current === run.id) return;
    pipelineAsked.current = run.id;
    refreshNow();
  });
  const updated = agoText(Math.max(0, Math.round((nowMs - (refresh?.updatedAt ?? loadedAt)) / 1000)));
  const tabActive = useTabActiveRef();
  useEffect(() => {
    closeRef.current?.focus();
    // Nothing while the Runs tab is hidden (an Esc or a click on the other tab is not meant for this drawer).
    const onKey = (e: KeyboardEvent) => tabActive.current && e.key === 'Escape' && onClose();
    // Clicks outside close it, except on run history boxes, which open or stack runs.
    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (tabActive.current && t instanceof Element && !t.closest('.dr, .rh')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [onClose, tabActive]);

  const elapsed = elapsedSec(run, nowMs, loadedAt);
  const total = spanSec(run, elapsed);
  const rows = schedule(run, elapsed);
  /** Real tasks (live, replay) rather than the prototype's synthetic ones (mock). */
  const real = run.tasks !== undefined;
  const states = taskStates(run, elapsed);
  const { prefix, rest } = splitName(run.name);
  const last = lastRunSec(run, history);
  const max = Math.max(elapsed, last, run.usualSec, 1);
  const pct = (s: number) => `${Math.round((100 * s) / max)}%`;
  const groups = causeGroups(run);
  const nCauses = groups.length;
  const isFailed = run.result === 'failed';
  const shown = run.live ? durLive(elapsed) : dur(elapsed);
  const when = run.kind === 'queued' ? `queued since ${fmtStart(run.startTime)}`
    : run.live ? `started ${fmtStart(run.startTime)}, ${shown}`
      : isFailed || run.result === 'cancelled' ? `${run.result} ${fmtStart(run.startTime)}, after ${shown}`
        : `started ${fmtStart(run.startTime)}, ${shown}`;
  const nowCls = isFailed ? '' : run.kind === 'slow' || run.live || run.result === 'partial' ? ' amber' : run.result === 'succeeded' ? ' green' : ' grey';

  const isSel = (t: ScheduledTask) => (selIdx !== null ? t.i === selIdx : t.state === 'f' && t.fail === selTask);
  const pickRow = (t: ScheduledTask) => {
    setSelIdx(t.i);
    if (t.fail !== undefined) setSelTask(t.fail);
  };
  const pickFailure = (j: number) => {
    setSelTask(j);
    setSelIdx(null);
  };
  const picked = selIdx !== null ? rows[selIdx] : undefined;
  const hintFor = (t: ScheduledTask | undefined) =>
    t?.state === 'f' ? run.failed[t.fail ?? 0]?.cause.label : t?.state === 'r' && run.kind === 'retrying' ? 'retrying' : undefined;
  // The task whose log shows in the right-hand column (set by whichever Task stop the route ends on).
  let logFor: { task: string; hint?: string; failed: boolean } | undefined;
  const taskPanel = (name: string, t: ScheduledTask | undefined, kind = 'Python script', extra: Partial<Parameters<typeof TaskBody>[0]> = {}) => {
    logFor = { task: name, hint: hintFor(t), failed: t?.state === 'f' };
    return (
      <Panel key={`task-${name}`} cls="last" k="Task" v={<span className="mono-v">{name}</span>} r={real ? undefined : kind} open>
        {real && !Object.keys(run.params).length ? undefined : <TaskBody run={run} task={name} kind={kind} {...extra} />}
      </Panel>
    );
  };

  let tail: ReactNode;
  const failure = run.failed[selTask];
  if (failure) {
    const failRow = rows.find((t) => t.state === 'f' && t.fail === selTask);
    tail = (
      <>
        <Panel cls="fail" k="Root" v={failure.cause.label} open>
          <div className="err">
            {failure.cause.detail}<br />
            <span className="dim">{real ? [failure.name, failure.cause.code].filter(Boolean).join(', ') : `${failure.name}, line 41.${failure.cause.label === 'Table not found' ? ' Same error in 87 other jobs since 07:10.' : ''}`}</span>
          </div>
        </Panel>
        {taskPanel(picked ? picked.name : failure.name, picked ?? failRow)}
      </>
    );
  } else {
    let root: ReactNode;
    let task: ReactNode = picked ? taskPanel(picked.name, picked) : null;
    if (isFailed) {
      root = <Panel cls="fail" k="Root" v={run.cause.label} open><div className="err">{run.cause.detail}<br /><span className="dim">{run.cause.code}</span></div></Panel>;
    } else if (run.kind === 'slow' && real) {
      // The task to look at: the one still running, else the longest.
      const slowest = rows.find((t) => t.state === 'r') ?? [...rows].sort((a, b) => b.dur - a.dur)[0];
      root = (
        <Panel cls="fail" k="Root" v="Slower than usual" open>
          <div className="err">{slowest?.name ?? run.name}<br /><span className="dim">{run.live ? `${dur(elapsed)} so far` : `took ${dur(elapsed)}`}, usually {dur(run.usualSec)}.</span></div>
        </Panel>
      );
      if (slowest) task ??= taskPanel(slowest.name, slowest);
    } else if (run.kind === 'slow') {
      root = (
        <Panel cls="fail" k="Root" v="Slower than usual" open>
          <div className="err">transform<br /><span className="dim">{run.live ? `${dur(elapsed)} so far` : `took ${dur(elapsed)}`}, usually {dur(run.usualSec)}. Same parameters, code and cluster as the last run.</span></div>
        </Panel>
      );
      task ??= taskPanel('transform', rows.find((t) => t.name === 'transform'), 'Notebook', { compute: 'serverless', ext: '' });
    } else if (run.kind === 'running') {
      root = (
        <Panel cls="last" k="Root" v="Running, on track" open>
          <div className="kv"><span>progress</span><span>{runningIndex(run, elapsed)} of {run.ntasks} tasks done</span><span>elapsed</span><span>{dur(elapsed)}, average {dur(run.usualSec)}</span></div>
        </Panel>
      );
    } else if (run.kind === 'queued' && real) {
      root = <Panel cls="fail" k="Root" v="Queued" open><div className="err">{run.cause.code || 'Queued'}{run.cause.detail && <><br /><span className="dim">{run.cause.detail}</span></>}</div></Panel>;
    } else if (run.kind === 'queued') {
      root = <Panel cls="fail" k="Root" v="Queued" open><div className="err">MAX_CONCURRENT_RUNS_REACHED<br /><span className="dim">Job allows 1 concurrent run. The previous run is still going.</span></div></Panel>;
    } else if (run.kind === 'retrying' && real) {
      const rt = rows.find((t) => t.state === 'r' && (run.tasks?.[t.i]?.attempt ?? 0) > 0) ?? rows.find((t) => t.state === 'r');
      const attempt = rt ? (run.tasks?.[rt.i]?.attempt ?? 0) + 1 : undefined;
      root = <Panel cls="fail" k="Root" v="Retrying" open><div className="err">{rt ? rt.name : run.name}<br /><span className="dim">{attempt ? `attempt ${attempt}` : run.cause.detail}</span></div></Panel>;
      if (rt) task ??= taskPanel(rt.name, rt);
    } else if (run.kind === 'retrying') {
      root = <Panel cls="fail" k="Root" v="Cluster error, retrying" open><div className="err">spot instances reclaimed<br /><span className="dim">extract_bseg, attempt 1 failed after 48m 22s. Attempt 2 running on on-demand workers.</span></div></Panel>;
      task ??= taskPanel('extract_bseg', rows.find((t) => t.state === 'r'));
    } else {
      root = <Panel cls="last" k="Root" v={RESULT_ROOT[run.result ?? 'succeeded']} />;
    }
    tail = <>{root}{task}</>;
  }

  return (
    <>
      <div className="dr-scrim" />
      <aside className={`dr${logFor ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={`Run of ${run.name}`} data-c="17">
        <div className="dh">
          <span className="title"><Glyph type={run.type} /><TitleLink url={run.url}><i>{prefix}</i>{rest}</TitleLink></span>
          <span className="when pill">{when}</span>
          <span className="rf">
            <span className="upd">{updated}</span>
            {refresh && (
              <button type="button" className={refresh.refreshing ? 'spin' : ''} onClick={refreshNow} disabled={refresh.refreshing} title="Refresh this run" aria-label="Refresh this run">↻</button>
            )}
            {refresh?.error && <em className="rf-err" title={refresh.error}>refresh failed</em>}
          </span>
          <button ref={closeRef} type="button" className="x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="dbody">
        <div className="trace">
          <div className="route">
            <Panel k={run.type === 'pipeline' ? 'Pipeline' : 'Job'} v={`${run.ntasks} tasks`} r={real ? `runs as ${run.runAs}` : `daily 06:00, runs as ${run.runAs}`} />
            <Panel k="Run" v={elapsed ? dur(elapsed) : 'not started'} r={`usual ${dur(run.usualSec)}`} open>
              <div className="cmp">
                <span>this run</span><div className="barx"><i className={`now${nowCls}`} style={{ width: pct(elapsed) }} /></div><span className="num">{elapsed ? dur(elapsed) : '0s'}</span>
                <span>last run</span><div className="barx"><i style={{ width: pct(last) }} /></div><span className="num">{dur(last)}</span>
                <span>usual</span><div className="barx"><i style={{ width: pct(run.usualSec) }} /></div><span className="num">{dur(run.usualSec)}</span>
              </div>
            </Panel>
            <Panel k="Tasks" v={tasksHead(run, elapsed)} r={run.failed.length > 1 ? `${nCauses} ${nCauses > 1 ? 'causes' : 'cause'}` : undefined} open>
              <div className="vsw">
                <span className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>Timeline</span>
                <span className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>Grid</span>
              </div>
              {view === 'timeline' ? (
                <Gantt run={run} rows={rows} total={total} isSel={isSel} onPick={pickRow} />
              ) : (
                <>
                  <div className="tasks">
                    {rows.map((t) => (
                      <i key={t.i} className={`${GRID_CLASS[t.state]}${t.state === 'f' && t.fail === selTask ? ' sel' : ''}`} onClick={t.fail !== undefined ? () => pickFailure(t.fail ?? 0) : undefined} />
                    ))}
                  </div>
                  <div className="tkey">
                    <span><i style={{ background: '#bfe0cf' } as CSSProperties} />ok</span>
                    {run.failed.length > 0 && <><span><i style={{ background: 'var(--red)' }} />failed</span><span><i style={{ background: '#e9e2d8' }} />skipped after a failure</span></>}
                    {states.includes('r') && <span><i style={{ background: '#b9cfea' }} />{run.kind === 'retrying' ? 'retrying' : 'running'}</span>}
                  </div>
                </>
              )}
              {run.failed.length > 1 && (
                <div className="flist">
                  {groups.map((g) => (
                    <div key={g.label}>
                      <div className="fgrp"><span>{g.label}</span><span className="n">{g.items.length}</span></div>
                      {g.items.map(({ f, i }) => (
                        <div key={i} className={`frow${i === selTask ? ' on' : ''}`} onClick={() => pickFailure(i)}>
                          <span>{f.name}</span><span className="r">{fmtStart(run.startTime)}, {f.secs}s</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            {tail}
          </div>
        </div>
        {logFor && (
          <section className="side" aria-label={`Log of ${logFor.task}`}>
            <TaskLog runId={run.id} task={logFor.task} hint={logFor.hint} failed={logFor.failed} nonce={logNonce} url={run.url} />
          </section>
        )}
        </div>
      </aside>
    </>
  );
}
