// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { RuntimeTile } from './RuntimeTile';
import { makeRun } from '../test/fixtures';

afterEach(cleanup);

const runs = [
  makeRun({ id: 1, kind: 'succeeded', durationSec: 180 }),
  makeRun({ id: 2, kind: 'failed', durationSec: 2400 }),
];

describe('RuntimeTile', () => {
  it('clicking a bar filters to its runs without moving the handles; clicking it again clears', () => {
    const dispatch = vi.fn();
    const { container, rerender } = render(<RuntimeTile runs={runs} range={null} dispatch={dispatch} />);
    fireEvent.click(container.querySelectorAll('.rt-bar')[1]);
    const call = dispatch.mock.calls[0][0];
    expect(call.runtime).toBeNull();
    expect(call.bar.min).toBeLessThanOrEqual(2400);
    expect(call.bar.max).toBe(Infinity);
    rerender(<RuntimeTile runs={runs} range={null} bar={call.bar} dispatch={dispatch} />);
    expect(container.querySelector('.rt-top b')!.textContent).toBe('runs of 40m 00s');
    expect(container.querySelector('.rt-top span')!.textContent).toBe('1 job');
    expect(container.querySelector('.rt-bar.sel')).toBe(container.querySelectorAll('.rt-bar')[1]);
    expect(container.querySelector('.rt-tile.on')).not.toBeNull();
    expect(container.querySelector('.rt-sel')).toBeNull(); // handles untouched
    fireEvent.click(container.querySelectorAll('.rt-bar')[1]);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'runtime', runtime: null, bar: null });
  });

  it('at rest reads any runtime with the shortest and longest run, and is not highlighted', () => {
    const { container } = render(<RuntimeTile runs={runs} range={null} dispatch={vi.fn()} />);
    expect(container.querySelector('.rt-top')!.textContent).toBe('any runtimeshortest 3m 00s · longest 40m 00s');
    expect(container.querySelector('.rt-tile.on')).toBeNull();
    expect(container.querySelectorAll('.rt-bars i')).toHaveLength(2);
    expect(container.querySelectorAll('[role="slider"]')).toHaveLength(2);
  });

  it('while filtering shows the range and how many runs are in it, highlighted; "any" clears', () => {
    const dispatch = vi.fn();
    const { container } = render(<RuntimeTile runs={runs} range={{ min: 1800, max: Infinity }} dispatch={dispatch} />);
    expect(container.querySelector('.rt-top b')!.textContent).toBe('30m and longer');
    expect(container.querySelector('.rt-top span')!.textContent).toBe('1 job');
    expect(container.querySelector('.rt-tile.on')).not.toBeNull();
    expect(container.querySelectorAll('.rt-bars i.in')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'any' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'runtime', runtime: null, bar: null });
  });

  it('reads a time scale under the track and each handle shows its value', () => {
    const { container, rerender } = render(<RuntimeTile runs={runs} range={null} dispatch={vi.fn()} />);
    expect([...container.querySelectorAll('.rt-tk')].map((t) => t.textContent)).toEqual(['10s', '1m', '5m', '40m']);
    expect([...container.querySelectorAll('[role="slider"]')].map((h) => h.textContent)).toEqual(['0', 'max']);
    rerender(<RuntimeTile runs={runs} range={{ min: 300, max: 1800 }} dispatch={vi.fn()} />);
    expect([...container.querySelectorAll('[role="slider"]')].map((h) => h.textContent)).toEqual(['5m', '30m']);
  });
});
