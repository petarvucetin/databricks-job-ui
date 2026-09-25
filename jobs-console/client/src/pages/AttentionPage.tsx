import { useRuns } from '../hooks/useRuns';
import { AttentionView } from './AttentionView';
import './attention.css';

export function AttentionPage() {
  const runs = useRuns();
  if (runs.state === 'loading') return <p className="att-status">Loading runs…</p>;
  if (runs.state === 'error') {
    return (
      <p className="att-status">
        <span>{runs.message}</span>
        <button type="button" onClick={runs.retry}>Retry</button>
      </p>
    );
  }
  return <AttentionView data={runs.data} loadedAt={runs.loadedAt} />;
}
