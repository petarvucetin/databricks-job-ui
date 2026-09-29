// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RefreshControl } from './RefreshControl';

afterEach(cleanup);

describe('RefreshControl', () => {
  it('offers off, 30s and 1 to 5 minutes, and reports the choice', () => {
    const onInterval = vi.fn();
    render(<RefreshControl intervalMs={60_000} onInterval={onInterval} onRefresh={() => {}} refreshing={false} error={null} />);
    const select = screen.getByLabelText<HTMLSelectElement>('Auto refresh interval');
    expect([...select.options].map((o) => o.textContent)).toEqual(['off', '30s', '1 min', '2 min', '3 min', '4 min', '5 min']);
    expect(select.value).toBe('60000');
    fireEvent.change(select, { target: { value: '180000' } });
    expect(onInterval).toHaveBeenCalledWith(180_000);
  });

  it('refreshes now on click, is disabled while refreshing, and shows a failed refresh', () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<RefreshControl intervalMs={0} onInterval={() => {}} onRefresh={onRefresh} refreshing={false} error={null} />);
    fireEvent.click(screen.getByLabelText('Refresh now'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    rerender(<RefreshControl intervalMs={0} onInterval={() => {}} onRefresh={onRefresh} refreshing error="Could not load runs: HTTP 502: boom" />);
    expect(screen.getByLabelText<HTMLButtonElement>('Refresh now').disabled).toBe(true);
    expect(screen.getByText('refresh failed').getAttribute('title')).toBe('Could not load runs: HTTP 502: boom');
  });
});
