// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { CopyButton } from './CopyButton';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('CopyButton', () => {
  it('copies the value, shows Copied for 1.2s, and does not click the row under it', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const onRow = vi.fn();
    const { container, getByRole } = render(<div onClick={onRow}><CopyButton value="[dev jo] finance_gl" label="run name" /></div>);
    const btn = getByRole('button', { name: 'Copy run name' });
    expect(btn.getAttribute('title')).toBe('Copy run name');
    expect(container.textContent).toBe('');
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('[dev jo] finance_gl');
    expect(onRow).not.toHaveBeenCalled();
    expect(btn.className).toBe('cp ok');
    expect(container.textContent).toBe('Copied');
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(btn.className).toBe('cp');
    expect(container.textContent).toBe('');
  });

  it('falls back to execCommand when the clipboard API is missing (plain http)', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;
    const { getByRole } = render(<CopyButton value="42" />);
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Copy value' }));
      await Promise.resolve();
    });
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
