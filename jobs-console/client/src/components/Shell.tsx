import type { ReactNode } from 'react';
import type { DataMode } from '../../../shared/domain/types';
import { CaptureMenu } from './CaptureMenu';
import './shell.css';

function badgeText(mode: DataMode): string {
  if (mode.source === 'mock') return 'mock data';
  const base = mode.source === 'replay' ? 'replay' : 'live data';
  return mode.auth === 'app' ? `${base} · as app` : base;
}

export function Shell({ mode, children }: { mode?: DataMode; children: ReactNode }) {
  return (
    <div className="shell">
      <header className="shell-top">
        <h1>Jobs console</h1>
        {mode && <span className="shell-badge">{badgeText(mode)}</span>}
        {mode?.capture && <CaptureMenu />}
      </header>
      <main className="shell-body">{children}</main>
    </div>
  );
}
