import type { ReactNode } from 'react';
import type { DataMode } from '../../../shared/domain/types';
import { CaptureMenu } from './CaptureMenu';
import './shell.css';

function badgeText(mode: DataMode): string {
  if (mode.source === 'mock') return 'mock data';
  const base = mode.source === 'replay' ? 'replay' : 'live data';
  return mode.auth === 'app' ? `${base} · as app` : base;
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

export function Shell({ mode, children }: { mode?: DataMode; children: ReactNode }) {
  return (
    <div className="shell">
      <header className="shell-top">
        <h1>Jobs console</h1>
        {mode && <span className="shell-badge">{badgeText(mode)}</span>}
        {mode && <Workspace mode={mode} />}
        {mode && <Identity mode={mode} />}
        {mode?.capture && <CaptureMenu />}
      </header>
      <main className="shell-body">{children}</main>
    </div>
  );
}
