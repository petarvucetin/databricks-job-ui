// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useContext, useEffect } from 'react';
import { TabActiveContext } from './hooks/useTabActive';
import App from './App';

// The pages are stand-ins that show their props and the active-tab context, and count their mounts.
const mounted = vi.hoisted(() => ({ jobs: vi.fn<() => void>(), runs: vi.fn<() => void>() }));
vi.mock('./pages/JobsPage', () => ({
  JobsPage: ({ active, onSeeRuns }: { active: boolean; onSeeRuns: (name: string) => void }) => {
    const ctx = useContext(TabActiveContext);
    useEffect(() => {
      mounted.jobs();
    }, []);
    return <button type="button" data-testid="jobs-page" onClick={() => onSeeRuns('nightly')}>{`jobs active=${active} ctx=${ctx}`}</button>;
  },
}));
vi.mock('./pages/AttentionPage', () => ({
  AttentionPage: ({ focus }: { focus?: { query?: string } }) => {
    const ctx = useContext(TabActiveContext);
    useEffect(() => {
      mounted.runs();
    }, []);
    return <p data-testid="runs-page">{`runs ctx=${ctx} focus=${focus?.query ?? ''}`}</p>;
  },
}));
vi.mock('./hooks/useRunsData', () => ({ useRunsData: () => ({ runs: { state: 'loading' }, single: undefined, intervalMs: 0, setIntervalMs: () => {} }) }));

beforeEach(() => {
  mounted.jobs.mockClear();
  mounted.runs.mockClear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const wrapper = (testId: string) => screen.getByTestId(testId).parentElement!;

describe('App tabs', () => {
  it('?tab=jobs opens on Jobs & ETL; the Runs page is mounted too, in a hidden wrapper, with its tab inactive', () => {
    window.history.replaceState(null, '', '/?tab=jobs');
    render(<App />);
    expect(screen.getByRole('button', { name: 'Jobs & ETL' }).className).toBe('on');
    expect(wrapper('jobs-page').hidden).toBe(false);
    expect(wrapper('runs-page').hidden).toBe(true);
    expect(screen.getByTestId('jobs-page').textContent).toBe('jobs active=true ctx=true');
    expect(screen.getByTestId('runs-page').textContent).toBe('runs ctx=false focus=');
  });

  it('clicking Runs sets ?tab=runs with replaceState and keeps the Jobs page mounted, hidden', () => {
    window.history.replaceState(null, '', '/?tab=jobs');
    const replace = vi.spyOn(window.history, 'replaceState');
    const before = window.history.length;
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(replace).toHaveBeenLastCalledWith(null, '', '?tab=runs');
    expect(window.location.search).toBe('?tab=runs');
    expect(window.history.length).toBe(before);
    expect(screen.getByRole('button', { name: 'Runs' }).className).toBe('on');
    expect(wrapper('jobs-page').hidden).toBe(true);
    expect(wrapper('runs-page').hidden).toBe(false);
    expect(screen.getByTestId('jobs-page').textContent).toBe('jobs active=false ctx=false');
    expect(screen.getByTestId('runs-page').textContent).toBe('runs ctx=true focus=');
    expect(mounted.jobs).toHaveBeenCalledTimes(1);
    expect(mounted.runs).toHaveBeenCalledTimes(1);
  });

  it('no ?tab opens on Runs; See runs from Jobs & ETL switches to Runs focused on the job', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Runs' }).className).toBe('on');
    expect(wrapper('runs-page').hidden).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Jobs & ETL' }));
    expect(window.location.search).toBe('?tab=jobs');
    fireEvent.click(screen.getByTestId('jobs-page'));
    expect(window.location.search).toBe('?tab=runs');
    expect(screen.getByTestId('runs-page').textContent).toBe('runs ctx=true focus=nightly');
  });
});
