import type { Run } from '../../../shared/domain/types';

const T0 = new Date(2026, 8, 22, 2, 41).getTime();

export function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: 1,
    runId: '630000000123456',
    type: 'job',
    name: '[prod] finance_gl_co_gl_journals_v3',
    kind: 'failed',
    cause: { label: 'Cluster error', code: 'CLOUD_FAILURE', detail: 'spot instances reclaimed' },
    startTime: T0,
    durationSec: 1404,
    usualSec: 1552,
    ntasks: 10,
    failed: [{ name: 'load_gl', cause: { label: 'Cluster error', code: 'CLOUD_FAILURE', detail: 'spot instances reclaimed' }, secs: 3 }],
    runAs: 'sp-finance',
    mine: false,
    live: false,
    continuous: false,
    result: 'failed',
    ...over,
  };
}
