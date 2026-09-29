import type { RunSource } from '../data/runSource';
import { orSourceError, type HandlerResult } from './listRuns';

const isTaskName = (s: string): boolean =>
  s.length >= 1 && s.length <= 200 && !/[/\\]/.test(s) && ![...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/**
 * `id` is a Run.id: a job run_id, or the number the live source derived for a pipeline update.
 * `task` is a job task key, or for a pipeline update the flow or pipeline name (ignored there), so it allows any
 * printable text without path separators.
 */
export async function taskLog(source: RunSource, id: string, query: Record<string, unknown>): Promise<HandlerResult> {
  if (!/^\d{1,16}$/.test(id) || !Number.isSafeInteger(Number(id))) return { status: 400, body: { error: 'run id must be a number' } };
  const { task, hint } = query;
  if (typeof task !== 'string' || !isTaskName(task)) return { status: 400, body: { error: 'task must be a task key' } };
  if (hint !== undefined && (typeof hint !== 'string' || hint.length > 60)) return { status: 400, body: { error: 'hint must be a short string' } };
  return orSourceError(async () => ({ status: 200, body: { text: await source.taskLog(Number(id), task, hint) } }));
}
