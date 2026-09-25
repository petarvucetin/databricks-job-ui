// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Timeline } from './Timeline';
import { makeRun } from '../test/fixtures';
import { presetWindow } from '../model/timeline';

afterEach(cleanup);

const end = new Date(2026, 8, 23).getTime();
const runs = [
  makeRun({ id: 1, startTime: new Date(2026, 8, 22, 5).getTime() }),
  makeRun({ id: 2, kind: 'succeeded', failed: [], startTime: new Date(2026, 8, 22, 6).getTime() }),
];

function setup(scale: '24h' | '30d' | '90d' = '30d') {
  const dispatch = vi.fn();
  const { container } = render(<Timeline runs={runs} end={end} scale={scale} window={presetWindow('last2', '30d', end)} cube={null} dispatch={dispatch} />);
  return { dispatch, container };
}

describe('Timeline', () => {
  it('draws one column per day at 30d, with the window label and span', () => {
    const { container } = setup();
    expect(container.querySelectorAll('.tl-col')).toHaveLength(30);
    expect(screen.getByText('Runs by day')).toBeTruthy();
    expect(screen.getByText('21 Sep to 23 Sep, 2 days')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'last 2 days' }).className).toContain('on');
  });

  it('draws hour columns at 24h and week columns at 90d', () => {
    expect(setup('24h').container.querySelectorAll('.tl-col')).toHaveLength(24);
    cleanup();
    expect(setup('90d').container.querySelectorAll('.tl-col')).toHaveLength(13);
  });

  it('dispatches scale, preset, column and count clicks', () => {
    const { dispatch, container } = setup();
    fireEvent.click(screen.getByRole('button', { name: '24h' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'scale', scale: '24h' });
    fireEvent.click(screen.getByRole('button', { name: 'today' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'preset', preset: 'today' });
    fireEvent.click(container.querySelectorAll('.tl-head')[29]);
    expect(dispatch).toHaveBeenCalledWith({ type: 'column', col: 29 });
    fireEvent.click(screen.getByTitle('Tue 22 Sep: 1 failed'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'cube', col: 29, kind: 'failed' });
  });
});
