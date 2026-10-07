import type { ReactNode } from 'react';
import type { DataMode, HistoryInfo } from '../../../shared/domain/types';
import appVersion from 'virtual:app-version';
import { CaptureMenu } from './CaptureMenu';
import './shell.css';

function badgeText(mode: DataMode): string {
  if (mode.source === 'mock') return 'mock data';
  const base = mode.source === 'replay' ? 'replay' : 'live data';
  const withAuth = mode.auth === 'app' ? `${base} · as app` : base;

  if (!mode.history) return withAuth;

  const historyPart = getHistoryPart(mode.history);
  return `${withAuth} · ${historyPart}`;
}

function getHistoryPart(history: HistoryInfo): string {
  const source = history.source === 'system-tables' ? 'system tables' : 'API';
  const base = `history: ${source} · ${history.days} ${history.days === 1 ? 'day' : 'days'}`;
  return history.capped ? `${base} · capped` : base;
}

function badgeTitle(mode: DataMode): string | null {
  if (!mode.history) return null;

  const history = mode.history;
  let baseTitle: string;

  if (history.source === 'system-tables') {
    baseTitle = 'Run history before today from system tables, today from the API';
  } else {
    const reason = history.reason ? `: ${history.reason}` : '';
    baseTitle = `Run history from the API only${reason}`;
  }

  if (history.capped) {
    // An incomplete job list caps a system-tables history too; it names that instead of a limit.
    return `${baseTitle}; ${history.source === 'system-tables' && history.reason ? history.reason : 'history limit reached'}`;
  }

  return baseTitle;
}

/** The monitored workspace, named by its host; links to the workspace. Nothing in mock mode. */
function Workspace({ mode }: { mode: DataMode }) {
  if (!mode.workspace) return null;
  const host = new URL(mode.workspace).host;
  const replay = mode.source === 'replay';
  const title = `${replay ? 'Capture taken from' : 'Monitoring'} ${mode.workspace}${mode.profile ? ` (CLI profile ${mode.profile})` : ''}`;
  return (
    <a className="shell-ws" href={mode.workspace} target="_blank" rel="noopener noreferrer" title={title}>
      {replay && <span>captured from </span>}
      {host}
      {mode.profile && <span className="shell-ws-profile"> · {mode.profile}</span>}
    </a>
  );
}

/** Who is looking, and who the data is read as when that's someone else (the app's service principal). */
function Identity({ mode }: { mode: DataMode }) {
  if (!mode.user) return null;
  const replay = mode.source === 'replay';
  const title = mode.readAs
    ? `Signed in as ${mode.user}. Jobs and pipelines are read as ${mode.readAs}, so you see what it can see.`
    : replay ? `Captured by ${mode.user}` : `Signed in as ${mode.user}; jobs and pipelines are read as you`;
  return (
    <span className="shell-user" title={title}>
      {replay && <span>by </span>}
      {mode.user}
      {mode.readAs && <span> · reads as {mode.readAs}</span>}
    </span>
  );
}

export type Tab = 'jobs' | 'runs';

export function Shell({ mode, tab, onTab, children }: { mode?: DataMode; tab?: Tab; onTab?: (t: Tab) => void; children: ReactNode }) {
  return (
    <div className="shell">
      <header className={`shell-top${onTab ? ' has-tabs' : ''}`}>
        <h1>Jobs console</h1>
        {onTab && (
          <nav className="tabs">
            <button type="button" className={tab === 'jobs' ? 'on' : undefined} onClick={() => onTab('jobs')}>Jobs &amp; ETL</button>
            <button type="button" className={tab === 'runs' ? 'on' : undefined} onClick={() => onTab('runs')}>Runs</button>
          </nav>
        )}
        {mode && <span className="shell-badge" title={badgeTitle(mode) ?? undefined}>{badgeText(mode)}</span>}
        {mode && <Workspace mode={mode} />}
        {mode && <Identity mode={mode} />}
        {mode?.capture && <CaptureMenu />}
        <span className="shell-ver" title={appVersion.commit ? `Built from commit ${appVersion.commit}, ${appVersion.date.slice(0, 16).replace('T', ' ')}` : undefined}>
          v{appVersion.version}{appVersion.commit && ` · ${appVersion.commit}`}
        </span>
      </header>
      <main className="shell-body">{children}</main>
    </div>
  );
}
