// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { RuntimeSlider } from './RuntimeSlider';
import { makeRun } from '../test/fixtures';

afterEach(cleanup);

const runs = [
  makeRun({ id: 1, kind: 'succeeded', durationSec: 180 }),
  makeRun({ id: 2, kind: 'failed', durationSec: 2400 }),
];

describe('RuntimeSlider', () => {
  it('draws runtime columns with count boxes and the number of runs in range', () => {
    const { container } = render(<RuntimeSlider runs={runs} range={null} dispatch={vi.fn()} />);
    expect(container.querySelectorAll('.tl-col')).toHaveLength(5);
    expect(container.querySelector('.tl-span')!.textContent).toBe('any runtime, 2 runs');
    expect(container.querySelector('.cube.failed')!.textContent).toBe('1');
  });

  it('a column click narrows to it; "any" clears', () => {
    const dispatch = vi.fn();
    const { container } = render(<RuntimeSlider runs={runs} range={{ min: 1800, max: Infinity }} dispatch={dispatch} />);
    expect(container.querySelector('.tl-span')!.textContent).toBe('30m and longer, 1 run');
    fireEvent.click(container.querySelectorAll('.tl-head')[1], { detail: 1 });
    expect(dispatch).toHaveBeenCalledWith({ type: 'runtime', runtime: { min: 300, max: 600 } });
    fireEvent.click(screen.getByRole('button', { name: 'any' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'runtime', runtime: null });
  });

  it('when the timeline is collapsed, shows the range only while it filters', () => {
    const { container, rerender } = render(<RuntimeSlider runs={runs} range={null} collapsed dispatch={vi.fn()} />);
    expect(container.textContent).toBe('');
    rerender(<RuntimeSlider runs={runs} range={{ min: 1800, max: Infinity }} collapsed dispatch={vi.fn()} />);
    expect(container.textContent).toBe(', 30m and longer');
  });
});
