// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { EnvSwitch } from './EnvSwitch';
import { pageTitle } from '../lib/env';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EnvSwitch', () => {
  it('marks the current env and opens another one as a real navigation, keeping the tab', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { container } = render(<EnvSwitch env="prod" envs={['dev', 'stg', 'prod']} tab="jobs" />);
    expect(container.querySelector('.env')).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['dev', 'stg', 'prod']);
    const prod = screen.getByRole('button', { name: 'prod' });
    expect(prod.getAttribute('aria-pressed')).toBe('true');
    expect(prod.className).toBe('on');
    expect(screen.getByRole('button', { name: 'dev' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'dev' }));
    expect(assign).toHaveBeenCalledWith('?env=dev&tab=jobs');
    assign.mockClear();
    fireEvent.click(prod);
    expect(assign).not.toHaveBeenCalled();
  });

  it('without a tab (compare page) opens the env alone', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<EnvSwitch env="dev" envs={['dev', 'prod']} />);
    fireEvent.click(screen.getByRole('button', { name: 'prod' }));
    expect(assign).toHaveBeenCalledWith('?env=prod');
  });

  it('without envs (deployed) is a label, not a switch', () => {
    const { container } = render(<EnvSwitch env="stg" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('.env-label')!.textContent).toBe('stg');
  });
});

describe('pageTitle', () => {
  it('prefixes the env in capitals, and leaves the title alone without one', () => {
    expect(pageTitle('Compare runs', 'stg')).toBe('STG · Compare runs');
    expect(pageTitle('Jobs console', 'prod')).toBe('PROD · Jobs console');
    expect(pageTitle('Jobs console')).toBe('Jobs console');
  });
});
