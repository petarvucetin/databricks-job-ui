import { useState } from 'react';
import { Shell, type Tab } from './components/Shell';
import { useDataMode } from './hooks/useDataMode';
import { useRunsData } from './hooks/useRunsData';
import { AttentionPage, type RunsFocus } from './pages/AttentionPage';
import { ComparePage } from './pages/ComparePage';
import { JobsPage } from './pages/JobsPage';
import { TabActiveContext } from './hooks/useTabActive';
import { currentEnv, envUrl, pageQuery } from './lib/env';
import type { DataMode } from '../../shared/domain/types';

/**
 * Makes the URL's env the one /api/mode describes: set (or corrected) when there is a switch, dropped when there isn't (E6).
 * Runs before any page mounts, so every data request carries the right env. A no-op once they agree.
 */
function syncEnvInUrl(mode: DataMode) {
  const search = window.location.search;
  const want = mode.envs ? mode.env : undefined;
  if (currentEnv(search) === want) return;
  const q = pageQuery(Object.fromEntries(new URLSearchParams(search)), want ? envUrl(want) : '');
  window.history.replaceState(null, '', q === '?' ? window.location.pathname : q);
}

export default function App() {
  const mode = useDataMode();
  // Until the env is known nothing that fetches is mounted, so no request goes out without it.
  if (!mode) return <Shell />;
  syncEnvInUrl(mode);
  if (new URLSearchParams(window.location.search).has('compare')) {
    return (
      <Shell mode={mode}>
        <ComparePage env={mode.env} />
      </Shell>
    );
  }
  return <Tabbed key={mode.env ?? ''} mode={mode} />;
}

function Tabbed({ mode }: { mode: DataMode }) {
  const [tab, setTabState] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('tab') === 'jobs' ? 'jobs' : 'runs'));
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, '', pageQuery({ tab: t }));
  };
  const data = useRunsData();
  const [focus, setFocus] = useState<RunsFocus>();
  // Where history came from is what the latest list says (finding 1); /api/mode's probe answer only until it arrives.
  const shellMode = data.runs.state === 'ready' ? { ...mode, history: data.runs.data.history } : mode;
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
