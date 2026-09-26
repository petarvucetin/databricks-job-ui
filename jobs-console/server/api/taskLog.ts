import type { RunSource } from '../data/runSource';
import type { HandlerResult } from './listRuns';

export async function taskLog(source: RunSource, id: string, query: Record<string, unknown>): Promise<HandlerResult> {
  if (!/^\d{1,18}$/.test(id)) return { status: 400, body: { error: 'run id must be a number' } };
  const { task, hint } = query;
  if (typeof task !== 'string' || !/^[\w.-]{1,120}$/.test(task)) return { status: 400, body: { error: 'task must be a task key' } };
  if (hint !== undefined && (typeof hint !== 'string' || hint.length > 60)) return { status: 400, body: { error: 'hint must be a short string' } };
  return { status: 200, body: { text: await source.taskLog(Number(id), task, hint) } };
}
