/** How far and how long one live list call may reach. Env overrides exist for large workspaces. */
export interface LiveLimits {
  windowDays: number;
  maxRuns: number;
  timeoutMs: number;
  concurrency: number;
}

export const DEFAULT_LIMITS: LiveLimits = { windowDays: 30, maxRuns: 2000, timeoutMs: 12000, concurrency: 8 };

const ENV: Record<keyof LiveLimits, string> = {
  windowDays: 'JOBS_CONSOLE_WINDOW_DAYS',
  maxRuns: 'JOBS_CONSOLE_MAX_RUNS',
  timeoutMs: 'JOBS_CONSOLE_TIMEOUT_MS',
  concurrency: 'JOBS_CONSOLE_CONCURRENCY',
};

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
