import { describe, expect, it } from 'vitest';
import { hasAnsi, parseAnsi, stripAnsi } from './ansi';

// Lines as they come from a real Databricks task (IPython traceback), CR included.
const TRACE = '\x1b[31mPy4JJavaError\x1b[39m                             Traceback (most recent call last)\r';
const CODE = '\x1b[32m      6\x1b[39m \x1b[38;5;28;01mdel\x1b[39;00m sys\r';
const HIGHLIGHT = '\x1b[32m----> \x1b[39m\x1b[32m9\x1b[39m   \x1b[43mexec\x1b[49m\x1b[43m(\x1b[49m\x1b[38;5;28;43mcompile\x1b[39;49m';

describe('stripAnsi', () => {
  it('removes colour codes and keeps the text', () => {
    expect(stripAnsi(TRACE)).toBe('Py4JJavaError                             Traceback (most recent call last)\r');
    expect(stripAnsi(CODE)).toBe('      6 del sys\r');
    expect(hasAnsi(TRACE)).toBe(true);
    expect(hasAnsi('plain')).toBe(false);
  });

  it('removes non-colour escapes too (cursor moves, erase line, OSC titles)', () => {
    expect(stripAnsi('a\x1b[2Kb\x1b[1Ac\x1b]0;title\x07d')).toBe('abcd');
  });
});

describe('parseAnsi', () => {
  it('colours the error name red and resets after it', () => {
    const { segments } = parseAnsi(TRACE);
    expect(segments[0]).toEqual({ text: 'Py4JJavaError', fg: '#c43d28' });
    expect(segments[1]?.fg).toBeUndefined();
  });

  it('reads 256-colour codes with bold, and the 39;00 reset', () => {
    const { segments } = parseAnsi(CODE);
    const del = segments.find((s) => s.text === 'del');
    expect(del).toMatchObject({ bold: true });
    expect(del?.fg).toMatch(/^rgb\(/);
    expect(segments.find((s) => s.text === ' sys\r')).toEqual({ text: ' sys\r' });
  });

  it('turns the yellow background highlight into a readable wash and merges equal neighbours', () => {
    const { segments } = parseAnsi(HIGHLIGHT);
    const hl = segments.filter((s) => s.bg);
    expect(hl.map((s) => s.text)).toEqual(['exec(', 'compile']);
    expect(hl[0]?.bg).toBe('#fdf0d8');
  });

  it('darkens colours too light for the paper background', () => {
    const light = parseAnsi('\x1b[38;5;250mgrey\x1b[39m').segments[0]?.fg ?? '';
    const [r, g, b] = (light.match(/\d+/g) ?? []).map(Number);
    expect((0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)) / 255).toBeLessThanOrEqual(0.61);
  });

  it('carries style across lines when a line does not reset', () => {
    const first = parseAnsi('\x1b[31mstill red');
    const second = parseAnsi('next line', first.end);
    expect(second.segments[0]).toEqual({ text: 'next line', fg: '#c43d28' });
  });

  it('handles 24-bit colour and a bare reset', () => {
    const { segments } = parseAnsi('\x1b[38;2;10;20;30mx\x1b[my');
    expect(segments).toEqual([{ text: 'x', fg: 'rgb(10, 20, 30)' }, { text: 'y' }]);
  });
});
