import { useState } from 'react';
import { Shell, type Tab } from './components/Shell';
import { useDataMode } from './hooks/useDataMode';
import { useRunsData } from './hooks/useRunsData';
import { AttentionPage, type RunsFocus } from './pages/AttentionPage';
import { ComparePage } from './pages/ComparePage';
import { JobsPage } from './pages/JobsPage';
import { TabActiveContext } from './hooks/useTabActive';

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
  // Where history came from is what the latest list says (finding 1); /api/mode's probe answer only until it arrives.
  const shellMode = mode && data.runs.state === 'ready' ? { ...mode, history: data.runs.data.history } : mode;
  return (
    <Shell mode={shellMode} tab={tab} onTab={setTab}>
      <div hidden={tab !== 'jobs'}>
        <TabActiveContext.Provider value={tab === 'jobs'}>
          <JobsPage
            data={data}
            active={tab === 'jobs'}
            onSeeRuns={(name) => { setFocus({ seq: Date.now(), query: name }); setTab('runs'); }}
            onOpenRun={(runId) => { setFocus({ seq: Date.now(), runId }); setTab('runs'); }}
          />
        </TabActiveContext.Provider>
      </div>
      <div hidden={tab !== 'runs'}>
        {/* Runs listeners (drawer Esc / outside click, the l/c/t keys) stay quiet while this tab is hidden. */}
        <TabActiveContext.Provider value={tab === 'runs'}>
          <AttentionPage key={focus?.seq ?? 0} data={data} focus={focus} />
        </TabActiveContext.Provider>
      </div>
    </Shell>
  );
}
