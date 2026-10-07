export interface HistoryConfig {
  warehouseId?: string;
  workspaceId?: string;
  /** JOBS_CONSOLE_HISTORY=off: history is switched off on purpose (told apart from "no warehouse" for the header reason). */
  off: boolean;
  /** False when JOBS_CONSOLE_HISTORY=off or no warehouse is configured: the API alone serves runs. */
  enabled: boolean;
}

export function readHistoryConfig(env: Record<string, string | undefined>): HistoryConfig {
  const warehouseId = env.DATABRICKS_WAREHOUSE_ID || undefined;
  const workspaceId = env.DATABRICKS_WORKSPACE_ID || undefined;
  const off = (env.JOBS_CONSOLE_HISTORY ?? '').trim().toLowerCase() === 'off';
  return { warehouseId, workspaceId, off, enabled: !off && !!warehouseId };
}
