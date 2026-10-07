import type { Item } from '../../../shared/domain/types';
import type { LiveApi } from '../live/api';
import { TIMEOUT, type Deadline } from '../live/collect';
import type { Draft } from '../live/kinds';
import type { PipelineRef } from '../live/liveRunSource';
import { pipelineNumber } from '../live/pipelines';
import { historyDrafts } from './mapHistory';
import { sqlFailureReason } from './probe';
import { JOB_RUNS_SQL, PIPELINE_UPDATES_SQL, TASK_DEPS_SQL, TASK_RUNS_SQL } from './queries';
import { runSql } from './sql';

export interface HistoryRead {
  drafts: Draft[];
  /** A query's row count reached maxRuns (its LIMIT): older runs may be missing (ruling R9). */
  capped: boolean;
  /** The pipeline updates among the drafts, so the drawer can refresh one and read its log. */
  refs: PipelineRef[];
}

/**
 * Runs that started in [from, to) from system tables: the four history queries at once, within `dl`, mapped against
 * the reading identity's items. Any failure or timeout answers the reason instead (the caller falls back to the API).
 */
export async function readHistory(o: { api: LiveApi; warehouseId: string; workspaceId: string; from: number; to: number; maxRuns: number; items: Item[]; host: string; dl: Deadline }): Promise<HistoryRead | { reason: string }> {
  const { api, warehouseId, dl } = o;
  // Strings, so a capture replays them exactly (decision H10).
  const params = { ws: o.workspaceId, from_ts: new Date(o.from).toISOString(), to_ts: new Date(o.to).toISOString(), max_runs: String(o.maxRuns) };
  let got;
  try {
    got = await Promise.all([
      runSql(api, warehouseId, JOB_RUNS_SQL, params, dl),
      runSql(api, warehouseId, TASK_RUNS_SQL, params, dl),
      runSql(api, warehouseId, TASK_DEPS_SQL, { ws: o.workspaceId }, dl),
      runSql(api, warehouseId, PIPELINE_UPDATES_SQL, params, dl),
    ]);
  } catch (e) {
    return { reason: sqlFailureReason(e) };
  }
  const [runs, tasks, deps, updates] = got;
  if (runs === TIMEOUT || tasks === TIMEOUT || deps === TIMEOUT || updates === TIMEOUT) return { reason: 'timed out' };
  const drafts = historyDrafts({ runs, tasks, deps, updates }, o.items, o.host, '');
  const updateIds = new Map(updates.map((u) => [pipelineNumber(u.update_id ?? ''), u.update_id ?? '']));
  const refs: PipelineRef[] = [];
  for (const d of drafts) {
    if (d.type !== 'pipeline' || !d.pipelineId) continue;
    refs.push({ pipelineId: d.pipelineId, updateId: updateIds.get(d.id) ?? '', startTime: d.startTime, info: { pipelineId: d.pipelineId, name: d.name, continuous: d.continuous, runAs: d.runAs } });
  }
  return { drafts, capped: runs.length >= o.maxRuns || updates.length >= o.maxRuns, refs };
}
