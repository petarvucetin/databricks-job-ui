/**
 * History queries over system.lakeflow (https://docs.databricks.com/aws/en/admin/system-tables/jobs).
 * Parameters (all sent as strings, so replay matches them exactly): :ws workspace id, :from_ts / :to_ts ISO instants
 * bounding the run start, :max_runs the history cap. Timestamps come back as epoch ms (start_ms, end_ms).
 *
 * The timeline tables slice long runs into hourly rows; result_state and termination_code are only set on the final
 * slice. Each run is aggregated over its slices, and a run whose final slice is not written yet (still running) is left
 * out: the API's active_only read covers it. Slices are read from a day before :from_ts so a run that started in range
 * keeps all of them.
 */

const WINDOW = `WHERE workspace_id = :ws
  AND period_start_time >= CAST(:from_ts AS TIMESTAMP) - INTERVAL 1 DAY`;

const FINAL = `MAX_BY(result_state, period_end_time) IS NOT NULL`;

const TIMES = `UNIX_MILLIS(MIN(period_start_time)) AS start_ms,
  UNIX_MILLIS(MAX(period_end_time)) AS end_ms,
  MAX_BY(result_state, period_end_time) AS result_state`;

export const JOB_RUNS_SQL = `SELECT job_id, run_id,
  ${TIMES},
  MAX_BY(termination_code, period_end_time) AS termination_code,
  MAX(run_type) AS run_type
FROM system.lakeflow.job_run_timeline
${WINDOW}
GROUP BY job_id, run_id
HAVING MIN(period_start_time) >= CAST(:from_ts AS TIMESTAMP)
  AND MIN(period_start_time) < CAST(:to_ts AS TIMESTAMP)
  AND ${FINAL}
ORDER BY start_ms DESC
LIMIT CAST(:max_runs AS INT)`;

/** Task runs (each retry is its own run_id) of runs in the window; a task can start after its run's start, so up to a day past :to_ts. */
export const TASK_RUNS_SQL = `SELECT job_id, job_run_id, run_id, task_key,
  ${TIMES},
  MAX_BY(termination_code, period_end_time) AS termination_code
FROM system.lakeflow.job_task_run_timeline
${WINDOW}
GROUP BY job_id, job_run_id, run_id, task_key
HAVING MIN(period_start_time) >= CAST(:from_ts AS TIMESTAMP)
  AND MIN(period_start_time) < CAST(:to_ts AS TIMESTAMP) + INTERVAL 1 DAY
  AND ${FINAL}`;

/** job_tasks is SCD2: the latest row per (job_id, task_key), dropped when that row records a deletion. */
export const TASK_DEPS_SQL = `SELECT job_id, task_key, depends_on_keys
FROM (
  SELECT job_id, task_key, TO_JSON(depends_on_keys) AS depends_on_keys, delete_time,
    ROW_NUMBER() OVER (PARTITION BY job_id, task_key ORDER BY change_time DESC) AS rn
  FROM system.lakeflow.job_tasks
  WHERE workspace_id = :ws
)
WHERE rn = 1 AND delete_time IS NULL`;

export const PIPELINE_UPDATES_SQL = `SELECT pipeline_id, update_id,
  ${TIMES},
  MAX_BY(run_as_user_name, period_end_time) AS run_as_user_name
FROM system.lakeflow.pipeline_update_timeline
${WINDOW}
GROUP BY pipeline_id, update_id
HAVING MIN(period_start_time) >= CAST(:from_ts AS TIMESTAMP)
  AND MIN(period_start_time) < CAST(:to_ts AS TIMESTAMP)
  AND ${FINAL}
ORDER BY start_ms DESC
LIMIT CAST(:max_runs AS INT)`;
