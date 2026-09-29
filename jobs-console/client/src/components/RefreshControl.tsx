import { REFRESH_OPTIONS } from '../hooks/useRefreshInterval';

/** Quiet auto-refresh control for the filter bar: interval picker, "refresh now", and a note when a refresh failed. */
export function RefreshControl({ intervalMs, onInterval, onRefresh, refreshing, error }: {
  intervalMs: number;
  onInterval: (ms: number) => void;
  onRefresh: () => void;
  refreshing: boolean;
  error: string | null;
}) {
  return (
    <span className="refresh">
      <label title="Refresh the runs automatically, without reloading the page">
        auto
        <select value={intervalMs} onChange={(e) => onInterval(Number(e.target.value))} aria-label="Auto refresh interval">
          {REFRESH_OPTIONS.map((o) => (
            <option key={o.ms} value={o.ms}>{o.label}</option>
          ))}
        </select>
      </label>
      <button type="button" className={refreshing ? 'spin' : ''} onClick={onRefresh} disabled={refreshing} title="Refresh now" aria-label="Refresh now">
        ↻
      </button>
      {error && <em className="refresh-err" title={error}>refresh failed</em>}
    </span>
  );
}
