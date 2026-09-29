import { useRefreshInterval } from '../hooks/useRefreshInterval';
import { useRuns } from '../hooks/useRuns';
import { RefreshControl } from '../components/RefreshControl';
import { AttentionView } from './AttentionView';
import './attention.css';

export function AttentionPage() {
  const [intervalMs, setIntervalMs] = useRefreshInterval();
  const runs = useRuns(intervalMs);
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
      data={runs.data}
      loadedAt={runs.loadedAt}
      refresh={<RefreshControl intervalMs={intervalMs} onInterval={setIntervalMs} onRefresh={runs.refresh} refreshing={runs.refreshing} error={runs.refreshError} />}
    />
  );
}
