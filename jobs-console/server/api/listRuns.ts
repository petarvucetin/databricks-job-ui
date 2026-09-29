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

const TZ_ERROR: HandlerResult = { status: 400, body: { error: 'tzOffset must be minutes between -840 and 840' } };

/** The `tzOffset` query (the client's getTimezoneOffset()): minutes, undefined when absent, or the 400 to answer with. */
export function parseTzOffset(raw: unknown): number | undefined | HandlerResult {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) return TZ_ERROR;
  const min = Number(raw);
  return min < -840 || min > 840 ? TZ_ERROR : min;
}

export async function listRuns(source: RunSource, query: Record<string, unknown>): Promise<HandlerResult> {
  const raw = query.since;
  let since: number | undefined;
  if (raw !== undefined) {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return { status: 400, body: { error: 'since must be epoch milliseconds' } };
    since = Number(raw);
  }
  const tzOffsetMin = parseTzOffset(query.tzOffset);
  if (typeof tzOffsetMin === 'object') return tzOffsetMin;
  return orSourceError(async () => ({ status: 200, body: await source.listRuns(since, tzOffsetMin) }));
}
