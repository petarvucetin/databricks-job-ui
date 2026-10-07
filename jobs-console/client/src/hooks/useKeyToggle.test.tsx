// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { useReferenceLabels } from './useKeyToggle';
import { TabActiveContext } from './useTabActive';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function Labels() {
  return <span data-testid="labels">{useReferenceLabels() ? 'on' : 'off'}</span>;
}
const view = (active: boolean) => (
  <TabActiveContext.Provider value={active}>
    <Labels />
  </TabActiveContext.Provider>
);

describe('useKeyToggle and the active tab', () => {
  it('with its tab inactive, l neither toggles the labels nor saves the choice; once active again it does', () => {
    const { rerender } = render(view(false));
    expect(screen.getByTestId('labels').textContent).toBe('on');
    fireEvent.keyDown(document, { key: 'l' });
    expect(screen.getByTestId('labels').textContent).toBe('on');
    expect(localStorage.getItem('jobs-console:labels')).toBeNull();

    rerender(view(true));
    fireEvent.keyDown(document, { key: 'l' });
    expect(screen.getByTestId('labels').textContent).toBe('off');
    expect(localStorage.getItem('jobs-console:labels')).toBe('0');
  });

  it('outside any provider (default active) l toggles as before', () => {
    render(<Labels />);
    fireEvent.keyDown(document, { key: 'l' });
    expect(screen.getByTestId('labels').textContent).toBe('off');
  });
});
