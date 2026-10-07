import type { RunsData } from '../hooks/useRunsData';
import { RefreshControl } from '../components/RefreshControl';
import { AttentionView } from './AttentionView';
import './attention.css';

/** Asks the Runs tab to open focused: search pre-filled with a job name, or one run's drawer open. A new `seq` is a new request. */
export interface RunsFocus {
  seq: number;
  query?: string;
  runId?: number;
}

export function AttentionPage({ data: { runs, single, intervalMs, setIntervalMs }, focus }: { data: RunsData; focus?: RunsFocus }) {
  if (runs.state === 'loading') return <p className="att-status">Loading runs…</p>;
  if (runs.state === 'error') {
    return (
      <p className="att-status">
        <span>{runs.message}</span>
        <button type="button" onClick={runs.retry}>Retry</button>
      </p>
    );
  }
  return (
    <AttentionView
      data={single?.data ?? runs.data}
      runRefresh={single}
      loadedAt={runs.loadedAt}
      initialQuery={focus?.query}
      initialRunId={focus?.runId}
      refresh={<RefreshControl intervalMs={intervalMs} onInterval={setIntervalMs} onRefresh={runs.refresh} refreshing={runs.refreshing} error={runs.refreshError} />}
    />
  );
}
