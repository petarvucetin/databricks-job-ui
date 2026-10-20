// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Shell } from './Shell';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Shell', () => {
  it('shows the app name and the data-mode badge', () => {
    render(<Shell mode={{ source: 'mock', capture: false }}><p>body</p></Shell>);
    expect(screen.getByRole('heading', { name: 'Jobs console' })).toBeTruthy();
    expect(screen.getByText('mock data')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('renders tabs and reports clicks', () => {
    const onTab = vi.fn();
    render(<Shell tab="runs" onTab={onTab}><p>x</p></Shell>);
    expect(screen.getByRole('button', { name: 'Runs' }).className).toContain('on');
    fireEvent.click(screen.getByRole('button', { name: 'Jobs & ETL' }));
    expect(onTab).toHaveBeenCalledWith('jobs');
  });

  it('renders no tabs without onTab', () => {
    const { container } = render(<Shell><p>x</p></Shell>);
    expect(container.querySelector('.tabs')).toBeNull();
    expect(container.querySelector('.shell-top')!.className).toBe('shell-top');
  });

  it('shows the version, bumped by every commit, with the commit it was built from', () => {
    const { container } = render(<Shell><p /></Shell>);
    const v = container.querySelector('.shell-ver')!;
    expect(v.textContent).toMatch(/^v\d+\.\d+\.\d+ · [0-9a-f]{7,}$/);
    expect(v.getAttribute('title')).toMatch(/^Built from commit [0-9a-f]{7,}, /);
  });

  it('names the monitored workspace and links to it', () => {
    render(<Shell mode={{ source: 'live', auth: 'app', capture: true, workspace: 'https://adb-1.2.azuredatabricks.net', profile: 'gov' }}><p /></Shell>);
    const link = screen.getByRole('link', { name: /adb-1\.2\.azuredatabricks\.net/ });
    expect(link.getAttribute('href')).toBe('https://adb-1.2.azuredatabricks.net');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('title')).toBe('Monitoring https://adb-1.2.azuredatabricks.net (CLI profile gov)');
    expect(link.textContent).toContain('gov');
  });

  it('says where a replayed capture came from, and names no workspace for mock data', () => {
    const { unmount } = render(<Shell mode={{ source: 'replay', capture: false, workspace: 'https://dbc-9.cloud.databricks.us' }}><p /></Shell>);
    expect(screen.getByRole('link').textContent).toBe('captured from dbc-9.cloud.databricks.us');
    unmount();
    render(<Shell mode={{ source: 'mock', capture: false }}><p /></Shell>);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows who is looking, and who the data is read as when that is the app', () => {
    const { unmount } = render(<Shell mode={{ source: 'live', auth: 'app', capture: true, user: 'petar@x.com', readAs: 'jobs-console-sp' }}><p /></Shell>);
    const who = screen.getByTitle(/Signed in as petar@x.com\. Jobs and pipelines are read as jobs-console-sp/);
    expect(who.textContent).toBe('petar@x.com · reads as jobs-console-sp');
    unmount();
    render(<Shell mode={{ source: 'live', auth: 'user', capture: true, user: 'petar@x.com' }}><p /></Shell>);
    expect(screen.getByTitle('Signed in as petar@x.com; jobs and pipelines are read as you').textContent).toBe('petar@x.com');
  });

  it('shows nobody in mock mode, and the capturing user in replay', () => {
    const { unmount } = render(<Shell mode={{ source: 'mock', capture: false }}><p /></Shell>);
    expect(screen.queryByTitle(/Signed in|Captured by/)).toBeNull();
    unmount();
    render(<Shell mode={{ source: 'replay', capture: false, user: 'petar@x.com' }}><p /></Shell>);
    expect(screen.getByTitle('Captured by petar@x.com').textContent).toBe('by petar@x.com');
  });

  it('hides the badge until the mode is known', () => {
    render(<Shell><p>body</p></Shell>);
    expect(screen.queryByText(/data$/)).toBeNull();
  });

  it('says live, replay, and as app honestly', () => {
    const { rerender } = render(<Shell mode={{ source: 'live', auth: 'user', capture: true }}><p /></Shell>);
    expect(screen.getByText('live data')).toBeTruthy();
    rerender(<Shell mode={{ source: 'live', auth: 'app', capture: true }}><p /></Shell>);
    expect(screen.getByText('live data · as app')).toBeTruthy();
    rerender(<Shell mode={{ source: 'replay', auth: 'user', capture: false }}><p /></Shell>);
    expect(screen.getByText('replay')).toBeTruthy();
  });

  it('shows the Capture menu only when capture is available', () => {
    const { rerender } = render(<Shell mode={{ source: 'mock', capture: false }}><p /></Shell>);
    expect(screen.queryByRole('button', { name: 'Capture' })).toBeNull();
    rerender(<Shell mode={{ source: 'live', auth: 'user', capture: true }}><p /></Shell>);
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    expect(screen.getByRole('menuitem', { name: 'Download capture' }).getAttribute('href')).toBe('/api/diag/capture');
    expect(screen.getByRole('menuitem', { name: 'Sweep 90 days + download' })).toBeTruthy();
  });

  it('shows system tables history in the badge', () => {
    render(<Shell mode={{ source: 'live', auth: 'user', capture: true, history: { source: 'system-tables', days: 90 } }}><p /></Shell>);
    const badge = screen.getByText(/live data · history: system tables · 90 days/);
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('title')).toBe('Run history before today from system tables, today from the API');
  });

  it('shows API history in the badge with reason in tooltip', () => {
    render(<Shell mode={{ source: 'live', auth: 'user', capture: true, history: { source: 'api', days: 30, reason: 'permission denied' } }}><p /></Shell>);
    const badge = screen.getByText(/live data · history: API · 30 days/);
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('title')).toBe('Run history from the API only: permission denied');
  });

  it('shows API history in the badge without reason when not provided', () => {
    render(<Shell mode={{ source: 'live', auth: 'user', capture: true, history: { source: 'api', days: 30 } }}><p /></Shell>);
    const badge = screen.getByText(/live data · history: API · 30 days/);
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('title')).toBe('Run history from the API only');
  });

  it('shows capped status in both system tables and API history', () => {
    const { rerender } = render(<Shell mode={{ source: 'live', auth: 'user', capture: true, history: { source: 'system-tables', days: 90, capped: true } }}><p /></Shell>);
    expect(screen.getByText(/live data · history: system tables · 90 days · capped/)).toBeTruthy();
    let badge = screen.getByText(/capped/);
    expect(badge.getAttribute('title')).toContain('history limit reached');
    rerender(<Shell mode={{ source: 'live', auth: 'user', capture: true, history: { source: 'api', days: 30, capped: true } }}><p /></Shell>);
    badge = screen.getByText(/capped/);
    expect(badge.getAttribute('title')).toContain('history limit reached');
  });

  it('does not change the badge for mock mode without history', () => {
    render(<Shell mode={{ source: 'mock', capture: false }}><p /></Shell>);
    expect(screen.getByText('mock data')).toBeTruthy();
    const badge = screen.getByText('mock data');
    expect(badge.getAttribute('title')).toBeNull();
  });

  it('with an env: the switch after the title, the env class on the header, and the env in the tab title', () => {
    document.title = 'jobs-console';
    const { container } = render(<Shell mode={{ source: 'mock', capture: false, env: 'prod', envs: ['dev', 'prod'] }} tab="runs" onTab={() => {}}><p /></Shell>);
    const top = container.querySelector('.shell-top')!;
    expect(top.className).toContain('env-prod');
    expect(top.children[0].tagName).toBe('H1');
    expect(top.children[1].className).toBe('env');
    expect(screen.getByRole('button', { name: 'prod' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.title).toBe('PROD · Jobs console');
  });

  it('deployed with an env: a label in the same place', () => {
    const { container } = render(<Shell mode={{ source: 'live', capture: false, env: 'stg' }}><p /></Shell>);
    expect(container.querySelector('.shell-top')!.className).toBe('shell-top env-stg');
    expect(container.querySelector('.env-label')!.textContent).toBe('stg');
    expect(container.querySelector('.env')).toBeNull();
  });

  it('with no env: no switch, no label, no env class, and the tab title as it was', () => {
    document.title = 'jobs-console';
    const { container } = render(<Shell mode={{ source: 'mock', capture: false }}><p /></Shell>);
    expect(container.querySelector('.env')).toBeNull();
    expect(container.querySelector('.env-label')).toBeNull();
    expect(container.querySelector('.shell-top')!.className).toBe('shell-top');
    expect(document.title).toBe('jobs-console');
  });

  it('shows a busy state while the sweep runs', async () => {
    let finish: (r: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (finish = r)));
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    render(<Shell mode={{ source: 'live', auth: 'user', capture: true }}><p /></Shell>);
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sweep 90 days + download' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/diag/sweep?days=90');
    expect(screen.getByText('Sweeping 90 days…')).toBeTruthy();
    finish(new Response(new Blob(['x']), { status: 200, headers: { 'Content-Disposition': 'attachment; filename="c.json.gz"' } }));
    await waitFor(() => expect(screen.queryByText('Sweeping 90 days…')).toBeNull());
    expect(createObjectURL).toHaveBeenCalled();
  });
});
