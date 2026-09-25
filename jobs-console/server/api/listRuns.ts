import type { RunSource } from '../data/runSource';

export interface HandlerResult {
  status: number;
  body: unknown;
}

export async function listRuns(source: RunSource, query: Record<string, unknown>): Promise<HandlerResult> {
  const raw = query.since;
  let since: number | undefined;
  if (raw !== undefined) {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return { status: 400, body: { error: 'since must be epoch milliseconds' } };
    since = Number(raw);
  }
  return { status: 200, body: await source.listRuns(since) };
}
