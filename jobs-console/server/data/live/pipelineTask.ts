import type { jobs, pipelines } from '@databricks/sdk-experimental';
import type { Cause } from '../../../shared/domain/types';
import { errorCause } from './pipelines';
import { pipelineLogText } from './taskLog';

/**
 * A job's pipeline task and the pipeline updates it ran. runs/get-output for the task returns a `pipeline_output` block
 * the SDK types leave out: `pipeline_request_id` is the update the task started, `pipeline_update_id` the latest one.
 * They differ when the update failed and the pipeline retried it on its own (cause RETRY_ON_FAILURE, up to
 * pipelines.numUpdateRetryAttempts times, 5 by default), all inside the one task.
 */
export function pipelineOutputOf(out: jobs.RunOutput | undefined): { requestId: string; updateId: string } | undefined {
  const po = (out as { pipeline_output?: { pipeline_request_id?: string; pipeline_update_id?: string } } | undefined)?.pipeline_output;
  const requestId = po?.pipeline_request_id || po?.pipeline_update_id;
  return requestId ? { requestId, updateId: po?.pipeline_update_id || requestId } : undefined;
}

/** The update the task started, then the pipeline's retries of it up to `lastId`, oldest first. */
export function attemptChain(updates: pipelines.UpdateInfo[], requestId: string, lastId: string): string[] {
  const sorted = [...updates].sort((a, b) => (a.creation_time ?? 0) - (b.creation_time ?? 0));
  const at = sorted.findIndex((u) => u.update_id === requestId);
  // Both ends must be in the list, or the walk could run on into a later run's retries.
  if (at < 0 || !sorted.some((u) => u.update_id === lastId)) return requestId === lastId ? [requestId] : [requestId, lastId];
  const chain = [requestId];
  for (const u of sorted.slice(at + 1)) {
    if (chain[chain.length - 1] === lastId) break;
    if (u.cause === 'RETRY_ON_FAILURE' && u.update_id) chain.push(u.update_id);
  }
  return chain;
}

/** The task's own error when it says more than "see the pipeline's logs". */
const GENERIC_TASK_ERROR = /refer to the logs for this pipeline/i;

/** Every attempt under its own heading with its ERROR and WARN events, oldest first, so the last attempt ends the log. */
export function pipelineTaskLogText(events: pipelines.PipelineEvent[], chain: string[], taskError?: string): string {
  const lines: string[] = [];
  chain.forEach((id, i) => {
    lines.push(`Pipeline update ${id.slice(0, 8)}, attempt ${i + 1} of ${chain.length} (${i ? 'the pipeline retried' : 'started by this task'})`);
    lines.push(pipelineLogText(events, id));
  });
  if (taskError && !GENERIC_TASK_ERROR.test(taskError)) lines.push(`ERROR ${taskError}`);
  return lines.join('\n');
}

/** Cause from the latest attempt that logged an error: its exception, preferring the event that names the failing flow. */
export function pipelineTaskCause(events: pipelines.PipelineEvent[], chain: string[]): { cause: Cause; flow?: string } | undefined {
  for (const id of [...chain].reverse()) {
    const errors = events.filter((e) => e.origin?.update_id === id && e.level === 'ERROR').sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
    if (!errors.length) continue;
    const named = errors.filter((e) => e.origin?.flow_name && e.error?.exceptions?.length);
    return errorCause(named.length ? named : errors);
  }
  return undefined;
}
