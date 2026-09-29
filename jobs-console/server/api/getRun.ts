import type { RunSource } from '../data/runSource';
import { orSourceError, parseTzOffset, type HandlerResult } from './listRuns';
import { BAD_RUN_ID, isRunId } from './taskLog';

/**
 * GET /api/runs/:id: one run, freshly read, in the same shape as in /api/runs. `id` is a Run.id (a job run_id, or the
 * number the live source derived for a pipeline update); `tzOffset` as for /api/runs (the mock source uses it).
 */
export async function getRun(source: RunSource, id: string, query: Record<string, unknown>): Promise<HandlerResult> {
  if (!isRunId(id)) return BAD_RUN_ID;
  const tzOffsetMin = parseTzOffset(query.tzOffset);
  if (typeof tzOffsetMin === 'object') return tzOffsetMin;
  return orSourceError(async () => ({ status: 200, body: await source.getRun(Number(id), tzOffsetMin) }));
}
