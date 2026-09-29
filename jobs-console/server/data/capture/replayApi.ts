import type { LiveApi } from '../live/api';
import type { Diag } from '../live/trace';
import type { CallRecord, RecordedError, SessionRecord } from './recorder';

const METHODS: (keyof LiveApi)[] = ['me', 'listJobRuns', 'getRun', 'getRunOutput', 'listPipelines', 'getPipeline', 'listUpdates', 'listPipelineEvents'];

/** JSON with object keys sorted and undefined dropped, so equal requests give equal strings. */
export function canon(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') {
      return Object.fromEntries(
        Object.keys(x)
          .sort()
          .filter((k) => (x as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, norm((x as Record<string, unknown>)[k])])
      );
    }
    return x;
  };
  return JSON.stringify(norm(v ?? {}));
}

/** Args that name what a call is about; a fallback that agrees on these is much nearer than one that doesn't. */
const IDENTITY = new Set(['page_token', 'pipeline_id', 'run_id', 'update_id']);

function nearness(want: Record<string, unknown>, have: Record<string, unknown>): number {
  let score = 0;
  for (const k of new Set([...Object.keys(want), ...Object.keys(have)])) {
    const same = canon(want[k]) === canon(have[k]);
    score += IDENTITY.has(k) ? (same ? 10 : -10) : same ? 1 : 0;
  }
  return score;
}

/** A recorded error thrown again the way the SDK threw it: same message (the raw one if the SDK mangled it), status and code. */
export function sdkError(r: RecordedError): Error {
  const e = Object.assign(new Error(r.raw ?? r.message), { statusCode: r.statusCode, errorCode: r.errorCode });
  e.name = r.name;
  if (r.stack) e.stack = r.stack;
  return e;
}

/**
 * LiveApi answered from recorded calls. Exact match on method + canonical args, the preferred session first, each
 * recorded answer served in order (the last one repeats). Otherwise the nearest same-method call, with a diagnostic.
 * A call cut off by the time budget when it was recorded is left unanswered, so the budget cuts it again.
 */
export function createReplayApi(sessions: SessionRecord[], preferred: SessionRecord | undefined, diag: Diag): LiveApi {
  const ordered = preferred ? [preferred, ...[...sessions].reverse().filter((s) => s !== preferred)] : [...sessions].reverse();
  const exact = new Map<string, { calls: CallRecord[]; next: number }>();
  const byMethod = new Map<string, CallRecord[]>();
  for (const s of ordered) {
    for (const c of s.calls) {
      const key = c.method + ' ' + canon(c.args);
      const slot = exact.get(key) ?? { calls: [], next: 0 };
      slot.calls.push(c);
      exact.set(key, slot);
      if (!c.cutOff) byMethod.set(c.method, [...(byMethod.get(c.method) ?? []), c]);
    }
  }

  const answer = (c: CallRecord): Promise<unknown> => {
    if (c.cutOff) return new Promise(() => {});
    return c.ok ? Promise.resolve(c.result) : Promise.reject(sdkError(c.error ?? { name: 'Error', message: 'recorded failure' }));
  };

  const replay = (method: keyof LiveApi, req: unknown): Promise<unknown> => {
    const args = (JSON.parse(canon(req)) ?? {}) as Record<string, unknown>;
    const slot = exact.get(method + ' ' + canon(args));
    if (slot) {
      const c = slot.calls[Math.min(slot.next, slot.calls.length - 1)];
      slot.next++;
      return answer(c);
    }
    const candidates = byMethod.get(method) ?? [];
    if (!candidates.length) {
      diag({ level: 'warn', code: 'replay-miss', message: `no recorded ${method} call; answering not found. args ${canon(args)}` });
      return Promise.reject(Object.assign(new Error(`Replay: no recorded ${method} call for ${canon(args)}`), { statusCode: 404, errorCode: 'RESOURCE_DOES_NOT_EXIST' }));
    }
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const c of candidates) {
      const s = nearness(args, (c.args ?? {}) as Record<string, unknown>);
      if (s > bestScore) [best, bestScore] = [c, s];
    }
    diag({ level: 'warn', code: 'replay-mismatch', message: `${method} ${canon(args)} was not recorded; answered with seq ${best.seq} ${canon(best.args)}` });
    return answer(best);
  };

  return Object.fromEntries(METHODS.map((m) => [m, (req: unknown) => replay(m, req)])) as unknown as LiveApi;
}
