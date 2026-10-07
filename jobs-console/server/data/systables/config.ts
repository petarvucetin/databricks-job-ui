export interface HistoryConfig {
  warehouseId?: string;
  workspaceId?: string;
  /** False when JOBS_CONSOLE_HISTORY=off or no warehouse is configured: the API alone serves runs. */
  enabled: boolean;
}

export function readHistoryConfig(env: Record<string, string | undefined>): HistoryConfig {
  const warehouseId = env.DATABRICKS_WAREHOUSE_ID || undefined;
  const workspaceId = env.DATABRICKS_WORKSPACE_ID || undefined;
  return { warehouseId, workspaceId, enabled: env.JOBS_CONSOLE_HISTORY !== 'off' && !!warehouseId };
}
