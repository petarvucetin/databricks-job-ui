import type { jobs, pipelines } from '@databricks/sdk-experimental';
import { oneLine } from './causes';

/** The task's latest attempt (highest attempt_number). */
export function findTask(run: jobs.Run, taskKey: string): jobs.RunTask | undefined {
  let found: jobs.RunTask | undefined;
  for (const t of run.tasks ?? []) {
    if (t.task_key === taskKey && (!found || (t.attempt_number ?? 0) >= (found.attempt_number ?? 0))) found = t;
  }
  return found;
}

/** Plain text from whatever runs/get-output returned: logs first, the error last (the client shows the tail). */
export function jobLogText(task: jobs.RunTask, out: jobs.RunOutput | undefined): string {
  const lines: string[] = [];
  if (out?.logs) lines.push(...out.logs.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));
  if (out?.logs_truncated) lines.push('[logs truncated]');
  if (out?.notebook_output?.result) lines.push(`Notebook result: ${out.notebook_output.result}${out.notebook_output.truncated ? ' [truncated]' : ''}`);
  if (out?.run_job_output?.run_id) lines.push(`Triggered run ${out.run_job_output.run_id}`);
  const sql = out?.sql_output;
  const sqlLink = sql?.query_output?.output_link ?? sql?.alert_output?.output_link;
  if (sqlLink) lines.push(`SQL output: ${sqlLink}`);
  if (out?.dbt_output?.artifacts_link) lines.push(`dbt artifacts: ${out.dbt_output.artifacts_link}`);
  if (out?.error_trace) lines.push(...out.error_trace.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));
  if (out?.error) lines.push(`ERROR ${oneLine(out.error)}`);
  if (lines.length) return lines.join('\n');
  const state = task.status?.state ?? task.state?.life_cycle_state;
  if (state === 'RUNNING' || state === 'TERMINATING') return 'No output yet: the task is still running.';
  if (state && state !== 'TERMINATED') return 'No output yet: the task has not started.';
  return 'No output recorded for this task.';
}

/** ERROR and WARN events of one update, oldest first, one line each, exception messages indented below. */
export function pipelineLogText(events: pipelines.PipelineEvent[], updateId: string): string {
  const mine = events
    .filter((e) => e.origin?.update_id === updateId && (e.level === 'ERROR' || e.level === 'WARN'))
    .sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
  if (!mine.length) return 'No warnings or errors recorded for this update.';
  const lines: string[] = [];
  for (const e of mine) {
    lines.push(`${e.timestamp ?? ''} ${e.level} ${oneLine(e.message ?? '')}`);
    for (const x of e.error?.exceptions ?? []) lines.push(`  ${x.class_name ? x.class_name.split('.').pop() + ': ' : ''}${oneLine(x.message ?? '')}`);
  }
  return lines.join('\n');
}
