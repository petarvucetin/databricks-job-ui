import { describe, it, expect } from 'vitest';
import { clientErrorFrom, visibleTo } from './diag';
import type { SessionRecord } from '../data/capture/recorder';

describe('client error body', () => {
  it('keeps the known fields as trimmed strings', () => {
    const e = clientErrorFrom({ message: 'boom', stack: 'at x', url: 'http://h/', userAgent: 'Edge', at: '2027-01-01T00:00:00Z', extra: 'dropped' });
    expect(e).toEqual({ message: 'boom', stack: 'at x', url: 'http://h/', userAgent: 'Edge', at: '2027-01-01T00:00:00Z' });
    expect(clientErrorFrom({ message: 'x'.repeat(5000) })?.message).toHaveLength(2000);
    expect(clientErrorFrom({ message: 'm', stack: 42 })?.stack).toBe('');
  });

  it('rejects a body without a message', () => {
    expect(clientErrorFrom(undefined)).toBeUndefined();
    expect(clientErrorFrom({ stack: 'x' })).toBeUndefined();
    expect(clientErrorFrom('boom')).toBeUndefined();
  });
});

describe('what a capture download holds', () => {
  const s = (id: string, user?: string) => ({ id, user }) as SessionRecord;
  const all = [s('a', 'ann@x.com'), s('b', 'BOB@x.com'), s('c')];

  it("only the requester's own sessions", () => {
    expect(visibleTo(all, 'bob@x.com', false).map((x) => x.id)).toEqual(['b']);
    expect(visibleTo(all, undefined, false)).toEqual([]);
  });

  it('everything on a local dev server (one user)', () => {
    expect(visibleTo(all, 'ann@x.com', true)).toHaveLength(3);
  });
});
