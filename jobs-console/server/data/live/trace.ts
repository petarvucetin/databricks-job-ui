import type { RefreshInfo } from '../../../shared/domain/types';
import type { LiveApi } from './api';
import type { LiveLimits } from './limits';
import type { ProbeResult } from '../systables/probe';

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
  /** What the source settled on: the asOf it used, the requester, the limits in effect, how it refreshed. */
  note(meta: TraceMeta): void;
}

export interface TraceMeta {
  now?: number;
  user?: string;
  limits?: LiveLimits;
  refresh?: RefreshInfo;
  /** The system-tables access probe's answer (possibly cached), so a replay answers it the same way. */
  probe?: ProbeResult;
}
