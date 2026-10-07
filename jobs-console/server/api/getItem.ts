import type { RunSource } from '../data/runSource';
import { orSourceError, type HandlerResult } from './listRuns';

export async function getItem(source: RunSource, type: string, id: string): Promise<HandlerResult> {
  if (type !== 'job' && type !== 'pipeline') return { status: 400, body: { error: 'type must be job or pipeline' } };
  if (!id || id.length > 100) return { status: 400, body: { error: 'bad id' } };
  return orSourceError(async () => ({ status: 200, body: await source.getItem(type, id) }));
}
