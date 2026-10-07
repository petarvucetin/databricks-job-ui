// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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
// The runs list as the page would have it: loading, unless a test sets a ready answer.
const runs = vi.hoisted(() => ({ state: { state: 'loading' } as Record<string, unknown> }));
vi.mock('./hooks/useRunsData', () => ({ useRunsData: () => ({ runs: runs.state, single: undefined, intervalMs: 0, setIntervalMs: () => {} }) }));

beforeEach(() => {
  runs.state = { state: 'loading' };
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

describe('App header: where history came from', () => {
  const OK_PROBE = { source: 'live', auth: 'user', capture: false, history: { source: 'system-tables', days: 90 } };
  const stubMode = (mode: unknown) => vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(mode), { status: 200 }))));
  const ready = (history: unknown) => ({ state: 'ready', data: { asOf: 0, source: 'live', runs: [], ...(history ? { history } : {}) }, loadedAt: 0, startedAt: 0, refreshing: false, refreshError: null, refresh: () => {} });
  const badge = () => document.querySelector('.shell-badge')!;

  it("shows /api/mode's answer until the first list arrives", async () => {
    stubMode(OK_PROBE);
    render(<App />);
    await waitFor(() => expect(badge().textContent).toBe('live data · history: system tables · 90 days'));
  });

  it("a history read that failed after an ok probe: the list's API label and reason win (finding 1)", async () => {
    stubMode(OK_PROBE);
    runs.state = ready({ source: 'api', days: 30, reason: 'warehouse error: The warehouse is starting' });
    render(<App />);
    await waitFor(() => expect(badge().textContent).toBe('live data · history: API · 30 days'));
    expect(badge().getAttribute('title')).toBe('Run history from the API only: warehouse error: The warehouse is starting');
  });

  it('a capped history shows "· capped"; an incomplete job list says so in the tooltip', async () => {
    stubMode(OK_PROBE);
    runs.state = ready({ source: 'system-tables', days: 90, capped: true });
    const { unmount } = render(<App />);
    await waitFor(() => expect(badge().textContent).toBe('live data · history: system tables · 90 days · capped'));
    expect(badge().getAttribute('title')).toBe('Run history before today from system tables, today from the API; history limit reached');
    unmount();
    runs.state = ready({ source: 'system-tables', days: 90, capped: true, reason: 'job list incomplete' });
    render(<App />);
    await waitFor(() => expect(badge().getAttribute('title')).toBe('Run history before today from system tables, today from the API; job list incomplete'));
  });

  it('a list that timed out on history reads "1 day"', async () => {
    stubMode(OK_PROBE);
    runs.state = ready({ source: 'api', days: 1, reason: 'timed out' });
    render(<App />);
    await waitFor(() => expect(badge().textContent).toBe('live data · history: API · 1 day'));
  });
});
