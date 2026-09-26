import { pad } from '../../../shared/domain/format';
import { LOG_A, LOG_B, LOG_C } from './logs';

const LOGS = [LOG_A, LOG_B, LOG_C];

/** Ending the prototype wrote for each failure cause: the sample log is cut short and this tail is appended. */
function tailFor(hint: string, task: string, T: (dm: number) => string): string[] {
  switch (hint) {
    case 'Table not found':
      return [
        `${T(0)} [pipeline] ${task} ctor`, `${T(0)} ctor took 0.000s`, `${T(0)} [${task}] [pipeline] pre_execute`, `${T(0)} [${task}] pre_execute took 0.011s`,
        `${T(1)} [${task}] [pipeline] execute`, `${T(1)} [load] target=finance.gl_staging mode=merge keys=[MANDT,BUKRS,BELNR,GJAHR]`,
        `${T(1)} [load] resolving target table`,
        `${T(1)} ERROR [${task}] execute failed after 2.104s`,
        'Traceback (most recent call last):', `  File "/Workspace/Repos/finance-gl/src/gl/${task}.py", line 41, in execute`, '    spark.table("finance.gl_staging")',
        'pyspark.errors.exceptions.captured.AnalysisException: [TABLE_OR_VIEW_NOT_FOUND] The table or view `finance`.`gl_staging` cannot be found. Verify the spelling and correctness of the schema and catalog. SQLSTATE: 42P01',
        `${T(1)} [pipeline] failed: ${task}`, `${T(1)} [pipeline] skipped: Publish, Notify`,
      ];
    case 'Cluster error':
      return [
        `${T(0)} [${task}] [pipeline] execute`, `${T(0)} [read] partitions=24 parallelism=6`,
        `${T(3)} WARN  [spark] Executor 4 lost: Spot instance reclaimed by cloud provider`,
        `${T(3)} WARN  [spark] Executor 2 lost: Spot instance reclaimed by cloud provider`,
        `${T(4)} ERROR [cluster] Driver terminated: CLOUD_PROVIDER_SHUTDOWN (spot capacity reclaimed, 2 of 6 workers)`,
        `${T(4)} [pipeline] failed: ${task} (cluster terminated)`,
      ];
    case 'Timed out':
      return [
        `${T(0)} [${task}] [pipeline] execute`, `${T(0)} [read] partitions=180 parallelism=6`,
        `${T(20)} [read] progress 61/180 partitions, elapsed 20m 14s`, `${T(40)} [read] progress 114/180 partitions, elapsed 40m 02s`,
        `${T(59)} [read] progress 171/180 partitions, elapsed 59m 48s`,
        `${T(59)} ERROR [runner] task timed out after 3600s (timeout_seconds=3600); cancelling`,
        `${T(59)} [pipeline] failed: ${task} (TIMEDOUT)`,
      ];
    case 'Permission denied':
      return [
        `${T(0)} [${task}] [pipeline] execute`, `${T(0)} [read] source=finance.raw_bkpf`,
        `${T(0)} ERROR [${task}] execute failed after 0.412s`,
        'pyspark.errors.exceptions.captured.AnalysisException: [INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table finance.raw_bkpf. SQLSTATE: 42501',
        `${T(0)} [pipeline] failed: ${task}`,
      ];
    case 'retrying':
      return [
        `${T(0)} [${task}] [pipeline] execute (attempt 3)`, `${T(0)} [read] resuming from checkpoint 2022-11 (attempt 2 reached 2022-10)`,
        `${T(5)} [read] partition 2024-06 8,412,003 rows 3m 41s`, `${T(9)} [read] partition 2024-07 8,977,210 rows 3m 18s`,
        `${T(12)} WARN  [read] partition 2025-03 skew on key MANDT=100, 71% of rows on one executor`,
        `${T(14)} [read] progress 78/92 partitions, elapsed 1h 32m, eta 26m`,
      ];
    default:
      return [`${T(0)} [pipeline] ${task} done`, `${T(0)} [pipeline] run complete, 0 errors`];
  }
}

/** Mock log for one task: one of three sample logs, ending in the failure the hint names (a cause label, or "retrying"). */
export function mockTaskLog(runId: number, task: string, hint?: string): string {
  const text = LOGS[(task.length + runId) % LOGS.length] ?? LOG_A;
  if (!hint) return text;
  const lines = text.split('\n');
  const keep = lines.slice(0, Math.max(40, lines.length - 12));
  const base = keep.length ? (keep[keep.length - 1] ?? '').slice(0, 5) : '12:00';
  const m = parseInt(base.slice(3), 10) || 0;
  const h = base.slice(0, 2);
  const T = (dm: number) => `${h}:${pad((m + dm) % 60)}:${pad(12 + ((dm * 7) % 47))}`;
  return keep.concat(tailFor(hint, task, T)).join('\n');
}
