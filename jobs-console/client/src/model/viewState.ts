import type { Run, RunKind } from '../../../shared/domain/types';
import { autoStatuses, type Filters, type Scope, type TimeWindow } from './filters';
import { buckets, clampWindow, domainStart, fitScale, presetWindow, sameWindow, type Preset, type ScaleId } from './timeline';

export const PAGE = 120;

export interface ViewCtx {
  runs: Run[];
  end: number;
}

export interface ViewState {
  filters: Filters;
  scale: ScaleId;
  cube: { col: number; kind: RunKind } | null;
  cap: number;
}

export type MenuKey = 'types' | 'runAs' | 'codes';

export type Action =
  | { type: 'scope'; scope: Scope }
  | { type: 'toggleMenu'; key: MenuKey; value: string }
  | { type: 'clearMenu'; key: MenuKey }
  | { type: 'query'; query: string }
  | { type: 'toggleLive' }
  | { type: 'toggleStatus'; kind: RunKind }
  | { type: 'scale'; scale: ScaleId }
  | { type: 'preset'; preset: Preset }
  | { type: 'column'; col: number }
  | { type: 'cube'; col: number; kind: RunKind }
  | { type: 'window'; window: TimeWindow }
  | { type: 'clear' }
  | { type: 'more' };

function withAuto(s: ViewState, ctx: ViewCtx): ViewState {
  return { ...s, filters: { ...s.filters, statuses: autoStatuses(ctx.runs, s.filters) } };
}

function setWindow(s: ViewState, window: TimeWindow, ctx: ViewCtx): ViewState {
  const filters = { ...s.filters, window };
  return withAuto({ ...s, filters, scale: fitScale(s.scale, window, ctx.end), cube: null }, ctx);
}

export function initialState(ctx: ViewCtx): ViewState {
  const filters: Filters = { scope: 'all', types: [], runAs: [], codes: [], statuses: [], live: false, query: '', window: presetWindow('last2', '30d', ctx.end) };
  return withAuto({ filters, scale: '30d', cube: null, cap: PAGE }, ctx);
}

export function applyAction(s: ViewState, a: Action, ctx: ViewCtx): ViewState {
  const f = s.filters;
  switch (a.type) {
    case 'scope':
      return { ...s, filters: { ...f, scope: a.scope }, cube: null };
    case 'toggleMenu': {
      const cur = f[a.key];
      const next = cur.includes(a.value) ? cur.filter((v) => v !== a.value) : [...cur, a.value];
      return { ...s, filters: { ...f, [a.key]: next } };
    }
    case 'clearMenu':
      return { ...s, filters: { ...f, [a.key]: [] } };
    case 'query':
      return { ...s, filters: { ...f, query: a.query } };
    case 'toggleLive':
      return withAuto({ ...s, filters: { ...f, live: !f.live }, cube: null }, ctx);
    case 'toggleStatus': {
      const statuses = f.statuses.includes(a.kind) ? f.statuses.filter((k) => k !== a.kind) : [...f.statuses, a.kind];
      return { ...s, filters: { ...f, statuses }, cube: null };
    }
    case 'scale': {
      const window = clampWindow(a.scale, f.window, ctx.end);
      return withAuto({ ...s, scale: a.scale, filters: { ...f, window }, cube: null }, ctx);
    }
    case 'preset':
      return setWindow(s, presetWindow(a.preset, s.scale, ctx.end), ctx);
    case 'window':
      return setWindow(s, a.window, ctx);
    case 'column': {
      const b = buckets(s.scale, ctx.end)[a.col];
      if (!b) return s;
      const one = { from: b.start, to: b.end };
      const all = { from: domainStart(s.scale, ctx.end), to: ctx.end };
      return setWindow(s, sameWindow(f.window, one) && !s.cube ? all : one, ctx);
    }
    case 'cube': {
      const b = buckets(s.scale, ctx.end)[a.col];
      if (!b) return s;
      if (s.cube && s.cube.col === a.col && s.cube.kind === a.kind) {
        return setWindow(s, { from: domainStart(s.scale, ctx.end), to: ctx.end }, ctx);
      }
      return { ...s, cube: { col: a.col, kind: a.kind }, filters: { ...f, window: { from: b.start, to: b.end }, statuses: [a.kind] } };
    }
    case 'clear': {
      const filters: Filters = { scope: f.scope, types: [], runAs: [], codes: [], statuses: [], live: false, query: '', window: presetWindow('last2', '30d', ctx.end) };
      return withAuto({ filters, scale: fitScale(s.scale, filters.window, ctx.end), cube: null, cap: PAGE }, ctx);
    }
    case 'more':
      return { ...s, cap: s.cap + PAGE };
  }
}
