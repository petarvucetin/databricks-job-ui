import type { pipelines } from '@databricks/sdk-experimental';
import type { Cause, RunResult } from '../../../shared/domain/types';
import { failureCause } from './causes';
import type { Draft } from './kinds';

export interface PipelineInfo {
  pipelineId: string;
  name: string;
  continuous: boolean;
  runAs: string;
}

/** What one events page says about one update. */
export interface UpdateEvents {
  /** Timestamp of the update's last update_progress event (its final state change), epoch ms. */
  endTime?: number;
  /** ERROR events, oldest first. */
  errors: pipelines.PipelineEvent[];
}

const MASK = (1n << 53n) - 1n;

/** Stable positive 53-bit integer for an update id (FNV-1a 64, folded). The same update always gets the same Run.id. */
export function pipelineNumber(updateId: string): number {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < updateId.length; i++) {
    h ^= BigInt(updateId.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return Number((h ^ (h >> 53n)) & MASK) || 1;
}

const ts = (e: pipelines.PipelineEvent): number => (e.timestamp ? Date.parse(e.timestamp) : NaN);

export function indexEvents(events: pipelines.PipelineEvent[]): Map<string, UpdateEvents> {
  const out = new Map<string, UpdateEvents>();
  for (const e of events) {
    const id = e.origin?.update_id;
    if (!id) continue;
    const u = out.get(id) ?? { errors: [] };
    out.set(id, u);
    const t = ts(e);
    if (e.event_type === 'update_progress' && !Number.isNaN(t) && (u.endTime === undefined || t > u.endTime)) u.endTime = t;
    if (e.level === 'ERROR') u.errors.push(e);
  }
  for (const u of out.values()) u.errors.sort((a, b) => ts(a) - ts(b));
  return out;
}

const QUEUED_STATES = new Set<string>(['QUEUED', 'CREATED', 'WAITING_FOR_RESOURCES']);
const LIVE_STATES = new Set<string>(['INITIALIZING', 'RESETTING', 'SETTING_UP_TABLES', 'RUNNING', 'STOPPING']);
const RESULTS: Record<string, RunResult> = { COMPLETED: 'succeeded', FAILED: 'failed', CANCELED: 'cancelled' };

/** Cause of a failed update: the first ERROR event that carries an exception (its message, not the top-level "Update is FAILED"). */
function errorCause(errors: pipelines.PipelineEvent[]): { cause: Cause; flow?: string } {
  const e = errors.find((x) => x.error?.exceptions?.length) ?? errors[0];
  if (!e) return { cause: failureCause('FAILED', '') };
  const ex = e.error?.exceptions?.[0];
  const message = ex?.message || e.message || '';
  const code = /\[([A-Z][A-Z0-9_]+)\]/.exec(message)?.[1] ?? ex?.class_name?.split('.').pop() ?? 'FAILED';
  return { cause: failureCause(code, message), flow: e.origin?.flow_name };
}

export function updateDraft(u: pipelines.UpdateInfo, p: PipelineInfo, events: UpdateEvents | undefined, now: number): Draft {
  const state = u.state ?? '';
  const queued = QUEUED_STATES.has(state);
  const live = LIVE_STATES.has(state);
  const start = u.creation_time ?? 0;
  const result = queued || live ? null : RESULTS[state] ?? 'failed';
  // UpdateInfo has no end time: the last update_progress event marks it. Without one, a finished update reports 0.
  const durationSec = queued ? 0 : live ? (now - start) / 1000 : events?.endTime ? (events.endTime - start) / 1000 : 0;
  const secs = Math.max(0, Math.round(durationSec));
  const failure = result === 'failed' ? errorCause(events?.errors ?? []) : undefined;
  const updateId = u.update_id ?? '';
  return {
    id: pipelineNumber(updateId),
    runId: 'upd ' + updateId.slice(0, 8),
    type: 'pipeline',
    name: p.name,
    key: `p:${p.pipelineId}`,
    startTime: start,
    durationSec: secs,
    ntasks: 1,
    failed: failure ? [{ name: failure.flow ?? p.name, cause: failure.cause, secs }] : [],
    runAs: p.runAs,
    live,
    queued,
    continuous: p.continuous,
    result,
    params: {},
    retryAttempt: live && u.cause === 'RETRY_ON_FAILURE' ? 1 : 0,
    cause: failure?.cause ?? null,
  };
}
