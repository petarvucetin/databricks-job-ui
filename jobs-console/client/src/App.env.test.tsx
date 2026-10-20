// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import App from './App';

// The real data hooks run here (useRunsData is not mocked); only the pages are stand-ins.
vi.mock('./pages/JobsPage', () => ({ JobsPage: () => <p data-testid="jobs-page" /> }));
vi.mock('./pages/AttentionPage', () => ({ AttentionPage: () => <p data-testid="runs-page" /> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

/** fetch that holds /api/mode until `answer` is called, and never answers anything else. */
function stubFetch() {
  let answer: (mode: unknown) => void = () => {};
  const fetchMock = vi.fn((input: string) => input.startsWith('/api/mode')
    ? new Promise<Response>((r) => (answer = (mode) => r(new Response(JSON.stringify(mode), { status: 200 }))))
    : new Promise<Response>(() => {}));
  vi.stubGlobal('fetch', fetchMock);
  const urls = () => fetchMock.mock.calls.map(([u]) => u);
  return { urls, answer: (mode: unknown) => answer(mode) };
}

const MODE = { env: 'dev', envs: ['dev', 'prod'], source: 'mock', capture: false };

describe('App: no request goes out without env (review focus 1)', () => {
  it('asks /api/mode first and nothing else; after it answers, every data call carries env=dev', async () => {
    window.history.replaceState(null, '', '/?env=dev');
    const f = stubFetch();
    render(<App />);
    expect(f.urls()).toEqual(['/api/mode?env=dev']);
    act(() => f.answer(MODE));
    await screen.findByTestId('runs-page');
    await waitFor(() => expect(f.urls().some((u) => u.startsWith('/api/runs'))).toBe(true));
    const data = f.urls().filter((u) => !u.startsWith('/api/mode'));
    expect(data.every((u) => new URL(u, 'http://x').searchParams.get('env') === 'dev')).toBe(true);
  });

  it('with no env in the URL, the first data call already carries the env /api/mode named', async () => {
    window.history.replaceState(null, '', '/?tab=jobs');
    const f = stubFetch();
    render(<App />);
    expect(f.urls()).toEqual(['/api/mode']);
    act(() => f.answer(MODE));
    await screen.findByTestId('jobs-page');
    await waitFor(() => expect(f.urls().some((u) => u.startsWith('/api/runs'))).toBe(true));
    const data = f.urls().filter((u) => !u.startsWith('/api/mode'));
    expect(data.every((u) => new URL(u, 'http://x').searchParams.get('env') === 'dev')).toBe(true);
  });
});
