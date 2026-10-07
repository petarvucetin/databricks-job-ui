import type { RunSource } from '../data/runSource';
import { orSourceError, type HandlerResult } from './listRuns';

export async function listItems(source: RunSource, _query: Record<string, unknown>): Promise<HandlerResult> {
  return orSourceError(async () => ({ status: 200, body: await source.listItems() }));
}
