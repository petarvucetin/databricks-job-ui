import { describe, it, expect } from 'vitest';
import { JOB_RUNS_SQL, PIPELINE_UPDATES_SQL, TASK_DEPS_SQL, TASK_RUNS_SQL } from './queries';

/** Smoke test of the SQL text, not a SQL engine: tables, workspace filter, parameters, the columns mapHistory reads. */
describe('history queries', () => {
  const windowed = { JOB_RUNS_SQL, TASK_RUNS_SQL, PIPELINE_UPDATES_SQL };

  it.each(Object.entries(windowed))('%s filters to the workspace and the [from_ts, to_ts) window, final slices only', (_, q) => {
    expect(q).toMatch(/WHERE workspace_id = :ws\b/);
    expect(q).toContain('CAST(:from_ts AS TIMESTAMP) - INTERVAL 1 DAY');
    expect(q).toContain('HAVING MIN(period_start_time) >= CAST(:from_ts AS TIMESTAMP)');
    expect(q).toContain(':to_ts');
    expect(q).toContain('MAX_BY(result_state, period_end_time) IS NOT NULL');
    expect(q).toContain('UNIX_MILLIS(MIN(period_start_time)) AS start_ms');
    expect(q).toContain('UNIX_MILLIS(MAX(period_end_time)) AS end_ms');
  });

  it('JOB_RUNS_SQL aggregates job_run_timeline per (job_id, run_id), newest first, capped by :max_runs', () => {
    expect(JOB_RUNS_SQL).toContain('FROM system.lakeflow.job_run_timeline');
    expect(JOB_RUNS_SQL).toContain('GROUP BY job_id, run_id');
    expect(JOB_RUNS_SQL).toContain('MAX_BY(termination_code, period_end_time) AS termination_code');
    expect(JOB_RUNS_SQL).toContain('MAX(run_type) AS run_type');
    expect(JOB_RUNS_SQL).toContain('MIN(period_start_time) < CAST(:to_ts AS TIMESTAMP)');
    expect(JOB_RUNS_SQL).toMatch(/ORDER BY start_ms DESC\s+LIMIT CAST\(:max_runs AS INT\)/);
  });

  it('TASK_RUNS_SQL aggregates job_task_run_timeline per (job_id, job_run_id, run_id, task_key)', () => {
    expect(TASK_RUNS_SQL).toContain('FROM system.lakeflow.job_task_run_timeline');
    expect(TASK_RUNS_SQL).toContain('GROUP BY job_id, job_run_id, run_id, task_key');
    expect(TASK_RUNS_SQL).toContain('MAX_BY(termination_code, period_end_time) AS termination_code');
  });

  it('TASK_DEPS_SQL takes the latest job_tasks row per (job_id, task_key), then drops deleted tasks', () => {
    expect(TASK_DEPS_SQL).toContain('FROM system.lakeflow.job_tasks');
    expect(TASK_DEPS_SQL).toMatch(/WHERE workspace_id = :ws\b/);
    expect(TASK_DEPS_SQL).toContain('PARTITION BY job_id, task_key ORDER BY change_time DESC');
    expect(TASK_DEPS_SQL).toContain('TO_JSON(depends_on_keys) AS depends_on_keys');
    expect(TASK_DEPS_SQL).toMatch(/rn = 1 AND delete_time IS NULL/);
  });

  it('PIPELINE_UPDATES_SQL aggregates pipeline_update_timeline per (pipeline_id, update_id), capped by :max_runs', () => {
    expect(PIPELINE_UPDATES_SQL).toContain('FROM system.lakeflow.pipeline_update_timeline');
    expect(PIPELINE_UPDATES_SQL).toContain('GROUP BY pipeline_id, update_id');
    expect(PIPELINE_UPDATES_SQL).toContain('MAX_BY(run_as_user_name, period_end_time) AS run_as_user_name');
    expect(PIPELINE_UPDATES_SQL).toContain('LIMIT CAST(:max_runs AS INT)');
  });
});
