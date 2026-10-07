import { useRefreshInterval } from './useRefreshInterval';
import { useRuns, type RunsState } from './useRuns';
import { useRunRefresh } from './useRunRefresh';

/** The runs list and its single-run refreshes, loaded once and shared by the Jobs & ETL and Runs tabs. */
export interface RunsData {
  runs: RunsState;
  /** The drawer's ↻ refreshes one run; its answer is merged into what the page shows until a newer list arrives. */
  single: ReturnType<typeof useRunRefresh>;
  intervalMs: number;
  setIntervalMs: (n: number) => void;
}

export function useRunsData(): RunsData {
  const [intervalMs, setIntervalMs] = useRefreshInterval();
  const runs = useRuns(intervalMs);
  const single = useRunRefresh(runs.state === 'ready' ? runs : undefined);
  return { runs, single, intervalMs, setIntervalMs };
}
