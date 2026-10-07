import { useState } from 'react';
import { Shell, type Tab } from './components/Shell';
import { useDataMode } from './hooks/useDataMode';
import { useRunsData } from './hooks/useRunsData';
import { AttentionPage, type RunsFocus } from './pages/AttentionPage';
import { ComparePage } from './pages/ComparePage';
import { JobsPage } from './pages/JobsPage';

export default function App() {
  const compare = new URLSearchParams(window.location.search).has('compare');
  const mode = useDataMode();
  if (compare) {
    return (
      <Shell mode={mode}>
        <ComparePage />
      </Shell>
    );
  }
  return <Tabbed mode={mode} />;
}

function Tabbed({ mode }: { mode: ReturnType<typeof useDataMode> }) {
  const [tab, setTabState] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('tab') === 'jobs' ? 'jobs' : 'runs'));
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, '', `?tab=${t}`);
  };
  const data = useRunsData();
  const [focus, setFocus] = useState<RunsFocus>();
  return (
    <Shell mode={mode} tab={tab} onTab={setTab}>
      <div hidden={tab !== 'jobs'}>
        <JobsPage
          data={data}
          onSeeRuns={(name) => { setFocus({ seq: Date.now(), query: name }); setTab('runs'); }}
          onOpenRun={(runId) => { setFocus({ seq: Date.now(), runId }); setTab('runs'); }}
        />
      </div>
      <div hidden={tab !== 'runs'}>
        <AttentionPage key={focus?.seq ?? 0} data={data} focus={focus} />
      </div>
    </Shell>
  );
}
