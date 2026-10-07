import type { RunsData } from '../hooks/useRunsData';

/** The Jobs & ETL tab. Filled in by the next tasks. */
export function JobsPage(_props: { data: RunsData; onSeeRuns: (name: string) => void; onOpenRun: (runId: number) => void }) {
  return <div className="jobs" />;
}
