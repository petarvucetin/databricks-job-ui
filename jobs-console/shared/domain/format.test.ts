import { describe, it, expect } from 'vitest';
import { dur, durLive, fmtStart, fmtEdge, dayLabel, pad } from './format';

describe('format', () => {
  it('pads to two digits', () => {
    expect(pad(3)).toBe('03');
    expect(pad(12)).toBe('12');
  });

  it('formats durations like the prototype', () => {
    expect(dur(0)).toBe('0s');
    expect(dur(59)).toBe('59s');
    expect(dur(249)).toBe('4m 09s');
    expect(dur(3900)).toBe('1h 05m');
    expect(dur(-5)).toBe('0s');
  });

  it('formats ticking durations with seconds always shown', () => {
    expect(durLive(249)).toBe('4m 09s');
    expect(durLive(3909)).toBe('1h 05m 09s');
    expect(durLive(7)).toBe('0m 07s');
  });

  it('formats start times and window edges in local time', () => {
    expect(fmtStart(new Date(2026, 8, 22, 2, 41).getTime())).toBe('22 Sep 02:41');
    expect(fmtEdge(new Date(2026, 8, 23).getTime())).toBe('23 Sep');
    expect(fmtEdge(new Date(2026, 8, 22, 14, 0).getTime())).toBe('22 Sep 14:00');
  });

  it('labels days', () => {
    expect(dayLabel(new Date(2026, 8, 22).getTime())).toEqual({ num: 22, mon: 'Sep', dow: 'Tue', full: '22 Sep' });
  });
});
