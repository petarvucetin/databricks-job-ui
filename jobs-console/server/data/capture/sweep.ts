import type { RunsResponse } from '../../../shared/domain/types';
import type { LiveApi } from '../live/api';
import { Deadline, TIMEOUT, pool } from '../live/collect';
import { apiErrorParts } from '../live/apiError';
import { createLiveRunSource, createLiveState } from '../live/liveRunSource';
import { DEFAULT_LIMITS, type LiveLimits } from '../live/limits';
import type { Session } from './recorder';
import type { HistoryConfig } from '../systables/config';

export const SWEEP_DEFAULT_DAYS = 90;
export const SWEEP_MAX_DAYS = 180;

/** ?days=N: an integer 1..180, default 90. Undefined when invalid. */
export function parseSweepDays(raw: unknown): number | undefined {
  if (raw === undefined || raw === '') return SWEEP_DEFAULT_DAYS;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= 1 && n <= SWEEP_MAX_DAYS ? n : undefined;
}

export function readSweepLimits(env: Record<string, string | undefined>): { timeoutMs: number; maxOutputs: number } {
  const num = (name: string, dflt: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return dflt;
    if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
    return Number(raw);
  };
  return { timeoutMs: num('JOBS_CONSOLE_SWEEP_TIMEOUT_MS', 240000), maxOutputs: num('JOBS_CONSOLE_SWEEP_MAX_OUTPUTS', 300) };
}

export interface SweepOptions {
  /** The requester's API: the sweep sees what they see. */
  api: LiveApi;
  user: () => Promise<string>;
  /** Records everything; the sweep becomes this session. */
  session: Session;
  days: number;
  timeoutMs: number;
  maxOutputs: number;
  concurrency: number;
  clock?: () => number;
  /** Clock for the time budget (default: clock). */
  timer?: () => number;
  /** Run history from system tables, as /api/runs reads it (the capture then carries the SQL). */
  history?: HistoryConfig;
}

/** getRun answered once per run id, so a run with several failed tasks costs one call (and one recorded call). */
function onceGetRun(api: LiveApi): LiveApi {
  const runs = new Map<number, ReturnType<LiveApi['getRun']>>();
  return {
    ...api,
    getRun: (req) => {
      let p = runs.get(req.run_id);
      if (!p) {
        p = api.getRun(req);
        runs.set(req.run_id, p);
      }
      return p;
    },
  };
}

/**
 * "Collect as much as possible": every job run and pipeline update in the last `days` (no run cap), then the log of
 * every failed task (getRun + getRunOutput, or the update's events), up to maxOutputs. One time budget for all of it;
 * hitting it returns what was collected, with a diagnostic.
 */
export async function runSweep(o: SweepOptions): Promise<RunsResponse> {
  const clock = o.clock ?? Date.now;
  const timer = o.timer ?? clock;
  const { session } = o;
  const endAt = timer() + o.timeoutMs;
  const limits: LiveLimits = { ...DEFAULT_LIMITS, windowDays: o.days, historyDays: o.days, maxRuns: Number.MAX_SAFE_INTEGER, timeoutMs: o.timeoutMs, concurrency: o.concurrency, itemsTimeoutMs: o.timeoutMs };
  const source = createLiveRunSource({
    api: onceGetRun(session.wrap(o.api)),
    user: o.user,
    userKey: 'sweep',
    state: createLiveState(),
    limits,
    clock,
    timer,
    warn: (m) => console.warn(`[sweep] ${m}`),
    // Calls are already recorded (inside the getRun de-dup); the source only adds diagnostics and notes.
    trace: { diag: (n) => session.diag(n), note: (m) => session.note(m), wrap: (a) => a },
    history: o.history,
    // The sweep's own budget for the history read too, not the 25 s a list waits next to the API.
    historyBudgetMs: o.timeoutMs,
  });
  const res = await source.listRuns();
  await source.listItems().catch(() => undefined);

  const wanted = res.runs.flatMap((r) => r.failed.map((f) => ({ id: r.id, runId: r.runId, task: f.name })));
  const todo = wanted.slice(0, o.maxOutputs);
  if (wanted.length > todo.length) {
    session.diag({ level: 'warn', code: 'outputs-capped', message: `read the output of ${todo.length} of ${wanted.length} failed tasks (JOBS_CONSOLE_SWEEP_MAX_OUTPUTS ${o.maxOutputs})` });
  }
  const dl = new Deadline(endAt, timer);
  let read = 0;
  let failed = 0;
  let late = 0;
  await pool(todo, o.concurrency, async (t) => {
    try {
      const text = await dl.call(() => source.taskLog(t.id, t.task));
      if (text === TIMEOUT) late++;
      else read++;
    } catch (e) {
      failed++;
      session.diag({ level: 'warn', code: 'output-failed', message: `task ${t.task}: ${apiErrorParts(e).message}`, ref: `run ${t.runId}` });
    }
  });
  if (late) session.diag({ level: 'warn', code: 'sweep-timeout', message: `time budget ${o.timeoutMs}ms ran out: ${late} of ${todo.length} task outputs not read` });
  else if (timer() >= endAt) session.diag({ level: 'warn', code: 'sweep-timeout', message: `time budget ${o.timeoutMs}ms ran out while listing; the list is partial` });
  session.diag({ level: 'info', code: 'sweep-outputs', message: `read ${read} of ${todo.length} failed task outputs, ${failed} failed, ${late} not reached; ${res.runs.length} runs in ${o.days} days` });
  return res;
}
