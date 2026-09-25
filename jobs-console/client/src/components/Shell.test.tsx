// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Shell } from './Shell';

afterEach(cleanup);

describe('Shell', () => {
  it('shows the app name and the data-mode badge', () => {
    render(<Shell source="mock"><p>body</p></Shell>);
    expect(screen.getByRole('heading', { name: 'Jobs console' })).toBeTruthy();
    expect(screen.getByText('mock data')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('hides the badge until the source is known', () => {
    render(<Shell><p>body</p></Shell>);
    expect(screen.queryByText(/data$/)).toBeNull();
  });
});
