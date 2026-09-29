import type { LiveApi } from '../live/api';
import { apiErrorParts } from '../live/apiError';
import type { LiveLimits } from '../live/limits';
import type { DiagNote, Trace } from '../live/trace';

/** An SDK error as recorded: the code and message are the ones apiErrorParts recovers; `raw` keeps the SDK's own message when it differs. */
export interface RecordedError {
  name: string;
  message: string;
  statusCode?: number;
  errorCode?: string;
  stack?: string;
  raw?: string;
}

export interface CallRecord {
  seq: number;
  method: keyof LiveApi;
  /** The request object, JSON-cloned. Requests carry ids, filters and page tokens, never credentials. */
  args: unknown;
  startedAt: number;
  ms: number;
  ok: boolean;
  result?: unknown;
  error?: RecordedError;
  /** Still in flight when the app request finished (the time budget dropped it). Replay leaves it unanswered. */
  cutOff?: true;
}

export interface ResponseSummary {
  status: number;
  runCount?: number;
  byKind?: Record<string, number>;
  byType?: Record<string, number>;
}

export interface SessionRecord {
  id: string;
  route: string;
  query: Record<string, unknown>;
  user?: string;
  authMode: string;
  startedAt: number;
  ms: number;
  /** The asOf the source used ("now" for kinds, live and durations). */
  now?: number;
  limits?: LiveLimits;
  calls: CallRecord[];
  diagnostics: DiagNote[];
  /** Diagnostics dropped past the per-session cap. */
  droppedDiagnostics?: number;
  responseSummary?: ResponseSummary;
  error?: { message: string; stack?: string };
}

export interface ClientErrorRecord {
  message: string;
  stack: string;
  url: string;
  userAgent: string;
  at: string;
  receivedAt?: number;
  user?: string;
}

export interface ProcessRecord {
  kind: 'unhandledRejection' | 'uncaughtException' | 'serverError';
  message: string;
  stack?: string;
  route?: string;
  at?: number;
}

const MAX_DIAGNOSTICS = 5000;

export function recordError(e: unknown): RecordedError {
  const { status, code, message } = apiErrorParts(e);
  const err = e instanceof Error ? e : undefined;
  const out: RecordedError = { name: err?.name ?? typeof e, message };
  if (status !== undefined) out.statusCode = status;
  if (code) out.errorCode = code;
  if (err?.stack) out.stack = err.stack;
  const raw = err ? err.message : String(e);
  if (raw !== message) out.raw = raw;
  return out;
}

const summarize = (status: number, body: unknown): ResponseSummary => {
  const runs = (body as { runs?: unknown } | undefined)?.runs;
  if (!Array.isArray(runs)) return { status };
  const count = (key: 'kind' | 'type') => {
    const out: Record<string, number> = {};
    for (const r of runs as Record<string, unknown>[]) out[String(r[key])] = (out[String(r[key])] ?? 0) + 1;
    return out;
  };
  return { status, runCount: runs.length, byKind: count('kind'), byType: count('type') };
};

/** One app request's worth of recorded calls and diagnostics. Plugs into a live source as its Trace. */
export class Session implements Trace {
  private readonly rec: SessionRecord;
  private seq = 0;
  private readonly pending = new Set<CallRecord>();

  constructor(
    init: { id: string; route: string; query: Record<string, unknown>; authMode: string; user?: string },
    private readonly clock: () => number = Date.now
  ) {
    this.rec = { ...init, startedAt: clock(), ms: 0, calls: [], diagnostics: [] };
    this.diag = this.diag.bind(this);
  }

  get id(): string {
    return this.rec.id;
  }

  diag(note: DiagNote): void {
    if (this.rec.diagnostics.length < MAX_DIAGNOSTICS) this.rec.diagnostics.push(note);
    else this.rec.droppedDiagnostics = (this.rec.droppedDiagnostics ?? 0) + 1;
  }

  note(meta: { now?: number; user?: string; limits?: LiveLimits }): void {
    if (meta.now !== undefined) this.rec.now = meta.now;
    if (meta.user !== undefined) this.rec.user = meta.user;
    if (meta.limits !== undefined) this.rec.limits = { ...meta.limits };
  }

  wrap(api: LiveApi): LiveApi {
    const out = {} as Record<string, unknown>;
    for (const method of Object.keys(api) as (keyof LiveApi)[]) {
      const fn = api[method] as (req?: unknown) => Promise<unknown>;
      if (typeof fn !== 'function') continue;
      out[method] = (req?: unknown) => {
        const call: CallRecord = { seq: ++this.seq, method, args: req === undefined ? {} : JSON.parse(JSON.stringify(req)), startedAt: this.clock(), ms: 0, ok: false };
        this.rec.calls.push(call);
        this.pending.add(call);
        const done = () => {
          call.ms = this.clock() - call.startedAt;
          this.pending.delete(call);
        };
        return fn(req).then(
          (result) => {
            done();
            call.ok = true;
            call.result = result;
            return result;
          },
          (e: unknown) => {
            done();
            call.error = recordError(e);
            throw e;
          }
        );
      };
    }
    return out as unknown as LiveApi;
  }

  /** Closes the session with the response it sent; calls still in flight are marked cut off. */
  finish(res: { status: number; body?: unknown; error?: unknown }): SessionRecord {
    this.rec.ms = this.clock() - this.rec.startedAt;
    this.rec.responseSummary = summarize(res.status, res.body);
    if (res.error !== undefined) {
      const e = res.error instanceof Error ? res.error : new Error(typeof res.error === 'string' ? res.error : JSON.stringify(res.error));
      this.rec.error = { message: e.message, stack: e.stack };
    }
    for (const c of this.pending) c.cutOff = true;
    return this.rec;
  }
}

export interface CaptureLimits {
  maxSessions: number;
  maxBytes: number;
}

export function readCaptureLimits(env: Record<string, string | undefined>): CaptureLimits {
  const num = (name: string, dflt: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return dflt;
    if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
    return Number(raw);
  };
  return { maxSessions: num('JOBS_CONSOLE_CAPTURE_SESSIONS', 20), maxBytes: num('JOBS_CONSOLE_CAPTURE_MB', 200) * 1024 * 1024 };
}

const MAX_SIDE = 200;

function pushBounded<T>(list: T[], item: T): void {
  list.push(item);
  if (list.length > MAX_SIDE) list.splice(0, list.length - MAX_SIDE);
}

/**
 * Ring buffer of finished sessions, newest last: at most maxSessions, and about maxBytes of JSON (the oldest go first;
 * the newest is always kept, however big). Plus the last 200 client errors and 200 process-level errors.
 */
export class CaptureStore {
  private readonly list: { rec: SessionRecord; size: number }[] = [];
  private readonly clientList: ClientErrorRecord[] = [];
  private readonly processList: ProcessRecord[] = [];
  bytes = 0;

  constructor(readonly limits: CaptureLimits) {}

  add(rec: SessionRecord): void {
    const size = JSON.stringify(rec).length;
    this.list.push({ rec, size });
    this.bytes += size;
    while (this.list.length > 1 && (this.list.length > this.limits.maxSessions || this.bytes > this.limits.maxBytes)) {
      this.bytes -= this.list.shift()!.size;
    }
  }

  sessions(): SessionRecord[] {
    return this.list.map((x) => x.rec);
  }

  addClientError(e: ClientErrorRecord): void {
    pushBounded(this.clientList, e);
  }

  clientErrors(): ClientErrorRecord[] {
    return [...this.clientList];
  }

  addProcess(p: ProcessRecord): void {
    pushBounded(this.processList, { at: Date.now(), ...p });
  }

  process(): ProcessRecord[] {
    return [...this.processList];
  }
}
