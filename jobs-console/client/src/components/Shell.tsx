import type { ReactNode } from 'react';
import './shell.css';

export function Shell({ source, children }: { source?: 'mock' | 'live'; children: ReactNode }) {
  return (
    <div className="shell">
      <header className="shell-top">
        <h1>Jobs console</h1>
        {source && <span className="shell-badge">{source === 'mock' ? 'mock data' : 'live data'}</span>}
      </header>
      <main className="shell-body">{children}</main>
    </div>
  );
}
