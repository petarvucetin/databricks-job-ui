// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { RunDrawer } from './RunDrawer';
import { makeRun } from '../test/fixtures';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => Promise.resolve({ ok: true, json: () => Promise.resolve({ text: `12:00:01 [pipeline] start\n12:00:02 ERROR [x] boom\nlog for ${url}` }) }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cause = (label: string) => ({ label, code: 'CLIENT_ERROR', detail: `${label} detail` });
const multi = makeRun({
  ntasks: 12,
  failed: [
    { name: 'load_a', cause: cause('Table not found'), secs: 4 },
    { name: 'load_b', cause: cause('Cluster error'), secs: 6 },
    { name: 'load_c', cause: cause('Table not found'), secs: 2 },
  ],
});

describe('RunDrawer', () => {
  it('shows the prototype header and the Job, Run, Tasks, Root and Task stops on the route', async () => {
    const { container } = render(<RunDrawer run={makeRun()} nowMs={0} loadedAt={0} onClose={() => {}} />);
    expect(container.querySelector('.dh .title')!.textContent).toBe('[prod] finance_gl_co_gl_journals_v3');
    expect(container.querySelector('.dh .ty svg')).not.toBeNull();
    expect(container.querySelector('.dh .when')!.textContent).toBe('failed 22 Sep 02:41, after 23m 24s');
    const ks = [...container.querySelectorAll('.route > .panel .hd .k')].map((k) => k.textContent);
    expect(ks).toEqual(['Job', 'Run', 'Tasks', 'Root', 'Task']);
    expect(container.querySelector('.panel.fail .hd .v')!.textContent).toBe('Cluster error');
    const cmp = [...container.querySelectorAll('.cmp .num')].map((n) => n.textContent);
    expect(cmp).toEqual(['23m 24s', '25m 52s', '25m 52s']);
    expect(container.querySelectorAll('.gantt .grow')).toHaveLength(10);
    expect(container.querySelector('.gantt .grow.sel .lbl')!.textContent).toBe('load_gl');
    await waitFor(() => expect(container.querySelector('.logh span')!.textContent).toBe('3 lines, ends at the error'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/runs/1/log?task=load_gl&hint=Cluster+error');
    expect(container.querySelector('.log .err')!.textContent).toContain('boom');
  });

  it('groups several failures by cause and switches the Root and Task stops to the picked one', () => {
    const { container } = render(<RunDrawer run={multi} nowMs={0} loadedAt={0} onClose={() => {}} />);
    expect(container.querySelector('.panel .hd .r.amber')!.textContent).toBe('2 causes');
    expect([...container.querySelectorAll('.fgrp')].map((g) => g.textContent)).toEqual(['Table not found2', 'Cluster error1']);
    fireEvent.click([...container.querySelectorAll('.frow')].find((r) => r.textContent.startsWith('load_b'))!);
    expect(container.querySelector('.panel.fail .hd .v')!.textContent).toBe('Cluster error');
    expect(container.querySelector('.panel.last .hd .v')!.textContent).toBe('load_b');
  });

  it('picks any task from the timeline, and shows the grid view on request', () => {
    const { container } = render(<RunDrawer run={makeRun()} nowMs={0} loadedAt={0} onClose={() => {}} />);
    fireEvent.click(container.querySelectorAll('.gantt .grow')[0]);
    expect(container.querySelector('.gantt .grow.sel .lbl')!.textContent).toBe('setup');
    expect(container.querySelector('.panel.last .hd .v')!.textContent).toBe('setup');
    fireEvent.click([...container.querySelectorAll('.vsw span')].find((s) => s.textContent === 'Grid')!);
    expect(container.querySelector('.gantt')).toBeNull();
    expect(container.querySelectorAll('.tasks i')).toHaveLength(10);
    expect(container.querySelectorAll('.tasks i.f')).toHaveLength(1);
  });

  it('collapses and opens a stop from its header', () => {
    const { container } = render(<RunDrawer run={makeRun()} nowMs={0} loadedAt={0} onClose={() => {}} />);
    const run = [...container.querySelectorAll('.route > .panel')][1];
    expect(run.className).toContain('open');
    fireEvent.click(run.querySelector('.hd')!);
    expect(run.className).not.toContain('open');
  });

  it('shows a running run as running and on track, ticking', () => {
    const run = makeRun({ kind: 'running', failed: [], live: true, result: null, durationSec: 600, usualSec: 1200 });
    const { container } = render(<RunDrawer run={run} nowMs={5000} loadedAt={0} onClose={() => {}} />);
    expect(container.querySelector('.dh .when')!.textContent).toBe('started 22 Sep 02:41, 10m 05s');
    expect(container.querySelector('.panel.last .hd .v')!.textContent).toBe('Running, on track');
    expect(container.querySelectorAll('.gantt .sq.r')).toHaveLength(1);
  });

  it('closes on Escape, the scrim and the close button', () => {
    const onClose = vi.fn();
    const { container } = render(<RunDrawer run={makeRun()} nowMs={0} loadedAt={0} onClose={onClose} />);
    expect(document.activeElement).toBe(container.querySelector('.dh .x'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(container.querySelector('.dr-scrim')!);
    fireEvent.click(container.querySelector('.dh .x')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
