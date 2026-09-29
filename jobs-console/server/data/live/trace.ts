import type { LiveApi } from './api';
import type { LiveLimits } from './limits';

/** A structured note the mapping code leaves instead of failing silently (unknown state, missing field, cap hit...). */
export interface DiagNote {
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  /** What it is about: a run id, update id, pipeline id. */
  ref?: string;
}

export type Diag = (note: DiagNote) => void;

export const noDiag: Diag = () => {};

/** Per-request hooks the capture recorder plugs into a live source. Absent: nothing is recorded. */
export interface Trace {
  diag: Diag;
  /** Wraps the request's LiveApi so every call is recorded. */
  wrap(api: LiveApi): LiveApi;
  /** What the source settled on: the asOf it used, the requester, the limits in effect. */
  note(meta: { now?: number; user?: string; limits?: LiveLimits }): void;
}
