/** How far and how long one live list call may reach. Env overrides exist for large workspaces. */
export interface LiveLimits {
  windowDays: number;
  maxRuns: number;
  timeoutMs: number;
  concurrency: number;
  /** Time budget of the Jobs & ETL definitions list, separate from the runs budget. */
  itemsTimeoutMs: number;
}

export const DEFAULT_LIMITS: LiveLimits = { windowDays: 30, maxRuns: 2000, timeoutMs: 12000, concurrency: 8, itemsTimeoutMs: 30000 };

const ENV: Record<keyof LiveLimits, string> = {
  windowDays: 'JOBS_CONSOLE_WINDOW_DAYS',
  maxRuns: 'JOBS_CONSOLE_MAX_RUNS',
  timeoutMs: 'JOBS_CONSOLE_TIMEOUT_MS',
  concurrency: 'JOBS_CONSOLE_CONCURRENCY',
  itemsTimeoutMs: 'JOBS_CONSOLE_ITEMS_TIMEOUT_MS',
};

/** How /api/runs refreshes: deltas over a per-user base snapshot, with a full load at least every fullRefreshMs. */
export interface RefreshSettings {
  /** JOBS_CONSOLE_INCREMENTAL=0 turns deltas off: every call is a full load. */
  incremental: boolean;
  /** JOBS_CONSOLE_FULL_REFRESH_MS: a base older than this is reloaded in full. */
  fullRefreshMs: number;
}

export const DEFAULT_REFRESH: RefreshSettings = { incremental: true, fullRefreshMs: 900000 };

export function readRefresh(env: Record<string, string | undefined>): RefreshSettings {
  const out = { ...DEFAULT_REFRESH };
  const inc = env.JOBS_CONSOLE_INCREMENTAL;
  if (inc !== undefined && inc !== '') {
    if (inc !== '0' && inc !== '1') throw new Error(`JOBS_CONSOLE_INCREMENTAL must be 0 or 1, got "${inc}"`);
    out.incremental = inc === '1';
  }
  const ms = env.JOBS_CONSOLE_FULL_REFRESH_MS;
  if (ms !== undefined && ms !== '') {
    if (!/^\d+$/.test(ms) || Number(ms) < 1) throw new Error(`JOBS_CONSOLE_FULL_REFRESH_MS must be a positive integer, got "${ms}"`);
    out.fullRefreshMs = Number(ms);
  }
  return out;
}

export function readLimits(env: Record<string, string | undefined>): LiveLimits {
  const out = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(ENV) as (keyof LiveLimits)[]) {
    const raw = env[ENV[key]];
    if (raw === undefined || raw === '') continue;
    if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`${ENV[key]} must be a positive integer, got "${raw}"`);
    out[key] = Number(raw);
  }
  return out;
}
