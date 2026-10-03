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
    expect(container.querySelector('.rt-top span')!.textContent).toBe('1 run');
    expect(container.querySelector('.rt-tile.on')).not.toBeNull();
    expect(container.querySelectorAll('.rt-bars i.in')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'any' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'runtime', runtime: null });
  });
});
