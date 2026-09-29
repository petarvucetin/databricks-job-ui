import type { RunSource } from '../data/runSource';
import { SourceError } from '../data/sourceError';

export interface HandlerResult {
  status: number;
  body: unknown;
}

/** A SourceError becomes its status and `{ error }`; anything else is a bug and propagates. */
export async function orSourceError(work: () => Promise<HandlerResult>): Promise<HandlerResult> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof SourceError) return { status: e.status, body: { error: e.message } };
    throw e;
  }
}

export async function listRuns(source: RunSource, query: Record<string, unknown>): Promise<HandlerResult> {
  const raw = query.since;
  let since: number | undefined;
  if (raw !== undefined) {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return { status: 400, body: { error: 'since must be epoch milliseconds' } };
    since = Number(raw);
  }
  const rawTz = query.tzOffset;
  let tzOffsetMin: number | undefined;
  if (rawTz !== undefined) {
    if (typeof rawTz !== 'string' || !/^-?\d+$/.test(rawTz)) return { status: 400, body: { error: 'tzOffset must be minutes between -840 and 840' } };
    tzOffsetMin = Number(rawTz);
    if (tzOffsetMin < -840 || tzOffsetMin > 840) return { status: 400, body: { error: 'tzOffset must be minutes between -840 and 840' } };
  }
  return orSourceError(async () => ({ status: 200, body: await source.listRuns(since, tzOffsetMin) }));
}
