/**
 * Links to a run's own page in the Databricks workspace.
 * Job run:         <origin>/jobs/<job_id>/runs/<run_id>[?o=<workspace id>]  (runs/list's run_page_url wins when present)
 * Pipeline update: <origin>/pipelines/<pipeline_id>/updates/<update_id>[?o=<workspace id>]
 * ?o= only on Azure, where the adb-<workspace id>.<n>.azuredatabricks.net host carries the id.
 */

/** Workspace origin from a host setting: https:// added when missing (Databricks Apps sets a bare host name), any path dropped. '' when unusable. */
export function workspaceOrigin(host: string | undefined): string {
  const h = (host ?? '').trim();
  if (!h) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(h) ? h : `https://${h}`);
    return u.hostname ? u.origin : '';
  } catch {
    return '';
  }
}

const AZURE = /^https:\/\/adb-(\d+)\.\d+\.(?:azuredatabricks\.net|databricks\.azure\.us|databricks\.azure\.cn)$/i;

/** "?o=<workspace id>" for an Azure per-workspace host, else ''. */
export function workspaceQuery(origin: string): string {
  const m = AZURE.exec(origin);
  return m ? `?o=${m[1]}` : '';
}

export function jobRunUrl(host: string | undefined, run: { job_id?: number; run_id?: number; run_page_url?: string }): string | undefined {
  if (run.run_page_url) return run.run_page_url;
  const o = workspaceOrigin(host);
  if (!o || run.job_id === undefined || run.run_id === undefined) return undefined;
  return `${o}/jobs/${run.job_id}/runs/${run.run_id}${workspaceQuery(o)}`;
}

export function pipelineUpdateUrl(host: string | undefined, pipelineId: string, updateId: string | undefined): string | undefined {
  const o = workspaceOrigin(host);
  if (!o || !pipelineId || !updateId) return undefined;
  return `${o}/pipelines/${encodeURIComponent(pipelineId)}/updates/${encodeURIComponent(updateId)}${workspaceQuery(o)}`;
}
