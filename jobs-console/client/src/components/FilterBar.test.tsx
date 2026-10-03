// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FilterBar } from './FilterBar';
import type { Filters } from '../model/filters';

afterEach(cleanup);

const filters: Filters = { scope: 'all', types: [], runAs: ['sp-ingest'], codes: [], statuses: [], live: false, query: '', window: { from: 0, to: 1 }, runtime: null, runtimeBar: null };
const menus = {
  types: [{ value: 'job', label: 'Job', count: 70 }, { value: 'pipeline', label: 'Pipeline', count: 30 }],
  runAs: [{ value: 'sp-finance', label: 'sp-finance', count: 40 }, { value: 'sp-ingest', label: 'sp-ingest', count: 60 }],
  codes: [{ value: 'none', label: 'no error code', count: 5 }],
};

function setup(over: Partial<Filters> = {}) {
  const dispatch = vi.fn();
  render(<FilterBar filters={{ ...filters, ...over }} scopeCounts={{ mine: 10, all: 251 }} menus={menus} liveCount={47} updatedText="updated 3s ago" dispatch={dispatch} />);
  return dispatch;
}

describe('FilterBar', () => {
  it('shows scope counts, the running toggle count and the update note', () => {
    setup();
    expect(screen.getByRole('button', { name: /All I can see\s*251/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Running now\s*47/ })).toBeTruthy();
    expect(screen.getByText('updated 3s ago')).toBeTruthy();
  });

  it('dispatches scope, running, search and clear', () => {
    const dispatch = setup();
    fireEvent.click(screen.getByRole('button', { name: /Mine\s*10/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'scope', scope: 'mine' });
    fireEvent.click(screen.getByRole('button', { name: /Running now/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleLive' });
    fireEvent.change(screen.getByPlaceholderText('search job, task, run id, cause, error'), { target: { value: 'gl' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'query', query: 'gl' });
    fireEvent.click(screen.getByRole('button', { name: 'clear filters' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'clear' });
  });

  it('opens a menu, toggles an option, and clears a menu', () => {
    const dispatch = setup();
    const runAs = screen.getByRole('button', { name: /^sp-ingest/ });
    fireEvent.click(runAs);
    fireEvent.click(screen.getByRole('checkbox', { name: /sp-finance/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleMenu', key: 'runAs', value: 'sp-finance' });
    fireEvent.click(screen.getByRole('button', { name: 'clear Run as' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'clearMenu', key: 'runAs' });
  });

  it('marks the running toggle when on', () => {
    setup({ live: true });
    expect(screen.getByRole('button', { name: /Running now/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
