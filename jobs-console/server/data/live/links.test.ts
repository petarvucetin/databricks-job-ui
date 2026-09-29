import { describe, it, expect } from 'vitest';
import { jobRunUrl, pipelineUpdateUrl, workspaceOrigin, workspaceQuery } from './links';

describe('workspace links', () => {
  it('normalises the host: scheme added, path and trailing slash dropped, junk rejected', () => {
    expect(workspaceOrigin('dbc-1a2b.cloud.databricks.com')).toBe('https://dbc-1a2b.cloud.databricks.com');
    expect(workspaceOrigin('https://x.cloud.databricks.us/')).toBe('https://x.cloud.databricks.us');
    expect(workspaceOrigin(' https://x.cloud.databricks.us/some/path ')).toBe('https://x.cloud.databricks.us');
    expect(workspaceOrigin(undefined)).toBe('');
    expect(workspaceOrigin('')).toBe('');
    expect(workspaceOrigin('http://')).toBe('');
  });

  it('job run: run_page_url from runs/list when present', () => {
    expect(jobRunUrl('https://x.cloud.databricks.us', { job_id: 42, run_id: 7, run_page_url: 'https://x.cloud.databricks.us/?o=1#job/42/run/7' }))
      .toBe('https://x.cloud.databricks.us/?o=1#job/42/run/7');
  });

  it('job run: built from host, job id and run id otherwise; none without a host or job id', () => {
    expect(jobRunUrl('https://x.cloud.databricks.us', { job_id: 42, run_id: 630000000000123 })).toBe('https://x.cloud.databricks.us/jobs/42/runs/630000000000123');
    expect(jobRunUrl('', { job_id: 42, run_id: 7 })).toBeUndefined();
    expect(jobRunUrl('https://x.cloud.databricks.us', { run_id: 7 })).toBeUndefined();
  });

  it('pipeline update: /pipelines/<id>/updates/<update id>', () => {
    expect(pipelineUpdateUrl('https://x.cloud.databricks.us', 'p-1', 'aaaa1111-0000')).toBe('https://x.cloud.databricks.us/pipelines/p-1/updates/aaaa1111-0000');
    expect(pipelineUpdateUrl(undefined, 'p-1', 'u')).toBeUndefined();
    expect(pipelineUpdateUrl('https://x.cloud.databricks.us', 'p-1', undefined)).toBeUndefined();
  });

  it('Azure: ?o=<workspace id> from the adb-<id>.<n> host', () => {
    expect(workspaceQuery('https://adb-1234567890123456.7.azuredatabricks.net')).toBe('?o=1234567890123456');
    expect(workspaceQuery('https://x.cloud.databricks.us')).toBe('');
    expect(jobRunUrl('adb-1234567890123456.7.azuredatabricks.net', { job_id: 42, run_id: 7 })).toBe('https://adb-1234567890123456.7.azuredatabricks.net/jobs/42/runs/7?o=1234567890123456');
    expect(pipelineUpdateUrl('https://adb-99.2.azuredatabricks.net', 'p', 'u')).toBe('https://adb-99.2.azuredatabricks.net/pipelines/p/updates/u?o=99');
  });
});
