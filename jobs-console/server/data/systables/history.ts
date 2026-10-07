import type { Item } from '../../../shared/domain/types';
import type { LiveApi } from '../live/api';
import { TIMEOUT, type Deadline } from '../live/collect';
import type { Draft } from '../live/kinds';
import type { PipelineRef } from '../live/liveRunSource';
import { pipelineNumber } from '../live/pipelines';
import { historyDrafts } from './mapHistory';
import { sqlFailure } from './probe';
import { JOB_RUNS_SQL, PIPELINE_UPDATES_SQL, TASK_DEPS_SQL, TASK_RUNS_SQL } from './queries';
import { runSql, type SqlRow } from './sql';

export interface HistoryRead {
  drafts: Draft[];
  /** A query's row count reached maxRuns (its LIMIT): older runs may be missing (ruling R9). */
  capped: boolean;
  /** The pipeline updates among the drafts, so the drawer can refresh one and read its log. */
  refs: PipelineRef[];
  /** The task-runs or dependencies query failed: the job runs have no task detail. Why, and whether that lasts the day. */
  noTasks?: HistoryFailure;
}

/** Why a history read failed; `lasting`: it fails the same way all day (no access, no table, a result too large). */
export interface HistoryFailure {
  reason: string;
  lasting: boolean;
}

type Rows = SqlRow[] | typeof TIMEOUT;

/**
 * Runs that started in [from, to) from system tables: the four history queries at once, within `dl`, mapped against
 * the reading identity's items. A failing or timed-out job-runs or pipeline-updates query answers the reason instead
 * (the caller falls back to the API); a failing task-runs or dependencies query only costs the task detail (finding 2b).
 */
export async function readHistory(o: { api: LiveApi; warehouseId: string; workspaceId: string; from: number; to: number; maxRuns: number; items: Item[]; host: string; dl: Deadline }): Promise<HistoryRead | HistoryFailure> {
  const { api, warehouseId, dl } = o;
  // Strings, so a capture replays them exactly (decision H10).
  const params = { ws: o.workspaceId, from_ts: new Date(o.from).toISOString(), to_ts: new Date(o.to).toISOString(), max_runs: String(o.maxRuns) };
  const settle = (p: Promise<Rows>): Promise<Rows | HistoryFailure> => p.catch((e: unknown) => sqlFailure(e));
  const [runs, tasks, deps, updates] = await Promise.all([
    settle(runSql(api, warehouseId, JOB_RUNS_SQL, params, dl)),
    settle(runSql(api, warehouseId, TASK_RUNS_SQL, params, dl)),
    settle(runSql(api, warehouseId, TASK_DEPS_SQL, params, dl)),
    settle(runSql(api, warehouseId, PIPELINE_UPDATES_SQL, params, dl)),
  ]);
  const failed = (r: Rows | HistoryFailure): HistoryFailure | undefined => (r === TIMEOUT ? { reason: 'timed out', lasting: false } : Array.isArray(r) ? undefined : r);
  const lost = failed(runs) ?? failed(updates);
  if (lost || !Array.isArray(runs) || !Array.isArray(updates)) return lost ?? { reason: 'timed out', lasting: false };
  const noTasks = failed(tasks) ?? failed(deps);
  try {
    const drafts = historyDrafts({ runs, updates, ...(Array.isArray(tasks) ? { tasks } : {}), ...(Array.isArray(deps) ? { deps } : {}) }, o.items, o.host, '');
    const updateIds = new Map(updates.map((u) => [pipelineNumber(u.update_id ?? ''), u.update_id ?? '']));
    const refs: PipelineRef[] = [];
    for (const d of drafts) {
      if (d.type !== 'pipeline' || !d.pipelineId) continue;
      refs.push({ pipelineId: d.pipelineId, updateId: updateIds.get(d.id) ?? '', startTime: d.startTime, info: { pipelineId: d.pipelineId, name: d.name, continuous: d.continuous, runAs: d.runAs } });
    }
    return { drafts, capped: runs.length >= o.maxRuns || updates.length >= o.maxRuns, refs, ...(noTasks ? { noTasks } : {}) };
  } catch (e) {
    // A mapping bug falls back to the API like a failed read, instead of failing the whole list (finding 13).
    return { reason: `mapping the history failed: ${e instanceof Error ? e.message : String(e)}`, lasting: false };
  }
}
