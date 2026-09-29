import type { Cause } from '../../../shared/domain/types';
import { stripAnsi } from '../../../shared/domain/ansi';

/** The mock's cause objects for the kinds that are not failures (see mock/generateRuns.ts). */
export const SUCCEEDED: Cause = { label: 'Succeeded', code: '', detail: '' };
export const RUNNING: Cause = { label: 'Running', code: '', detail: '' };
export const SLOW: Cause = { label: 'Slow', code: '', detail: '' };
export const QUEUED: Cause = { label: 'Queued', code: '', detail: '' };
export const FAILED: Cause = { label: 'Failed', code: '', detail: '' };

const CLUSTER_CODES = new Set(['CLOUD_FAILURE', 'CLUSTER_ERROR', 'DRIVER_ERROR', 'CLUSTER_REQUEST_LIMIT_EXCEEDED', 'INVALID_CLUSTER_REQUEST', 'MAX_SPARK_CONTEXTS_EXCEEDED']);

export const humanise = (code: string): string => {
  const s = code.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** One line of plain text: ANSI colour codes (IPython tracebacks) removed, whitespace collapsed. */
export const oneLine = (s: string): string => stripAnsi(s).replace(/\s+/g, ' ').trim();

const trim = (s: string, max = 200): string => (s.length > max ? s.slice(0, max - 1) + '…' : s);

/** Label from the mock vocabulary (Table not found, Cluster error, Timed out, Permission denied), else the humanised code. */
function labelFor(code: string, message: string, timedOut: boolean): string {
  if (timedOut || /\btimed?\s?out\b|TIMEDOUT/i.test(message)) return 'Timed out';
  if (/TABLE_OR_VIEW_NOT_FOUND|table or view .* (cannot|could not) be found|table .* not found/i.test(message)) return 'Table not found';
  if (code === 'UNAUTHORIZED_ERROR' || /INSUFFICIENT_PERMISSIONS|PERMISSION_DENIED|does not have .*(privilege|permission|SELECT|MODIFY|USE )/i.test(message)) return 'Permission denied';
  if (CLUSTER_CODES.has(code)) return 'Cluster error';
  return code ? humanise(code) : 'Failed';
}

export function failureCause(code: string | undefined, message: string | undefined, timedOut = false): Cause {
  const c = code ?? '';
  const m = oneLine(message ?? '');
  return { label: labelFor(c, m, timedOut), code: c, detail: trim(m) };
}
