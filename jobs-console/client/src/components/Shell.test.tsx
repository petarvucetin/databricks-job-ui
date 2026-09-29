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
