# Databricks notebook source
# MAGIC %md
# MAGIC # Install Jobs Console
# MAGIC
# MAGIC Installs the Jobs Console Databricks App from the Marketplace listing you just added.
# MAGIC
# MAGIC 1. Set **listing_catalog** to the catalog name you chose when you got the listing.
# MAGIC 2. Run all cells (serverless compute is fine).
# MAGIC
# MAGIC What it does:
# MAGIC - copies the prebuilt app from `/Volumes/<listing_catalog>/console/app/deploy` to your workspace folder
# MAGIC - creates the app (or reuses it if it already exists) and deploys that folder
# MAGIC - optionally grants the app's service principal **CAN_VIEW** on the jobs and pipelines you manage
# MAGIC
# MAGIC The app reads Jobs and Pipelines as its own service principal, so it only shows what that principal can view.
# MAGIC To re-install a newer version later, run this notebook again.

# COMMAND ----------

# MAGIC %pip install --quiet --upgrade databricks-sdk
# MAGIC %restart_python

# COMMAND ----------

dbutils.widgets.text("listing_catalog", "", "Listing catalog")
dbutils.widgets.text("app_name", "jobs-console", "App name")
dbutils.widgets.dropdown("grant_view", "no", ["no", "yes"], "Grant CAN_VIEW on jobs/pipelines I manage")

listing_catalog = dbutils.widgets.get("listing_catalog").strip()
app_name = dbutils.widgets.get("app_name").strip()
grant_view = dbutils.widgets.get("grant_view") == "yes"

assert listing_catalog, "Set the listing_catalog widget to the catalog name of the installed listing."

# COMMAND ----------

import os
import shutil

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
me = w.current_user.me().user_name

source = f"/Volumes/{listing_catalog}/console/app/deploy"
target = f"/Workspace/Users/{me}/apps/{app_name}"

assert os.path.exists(f"{source}/app.yaml"), f"No app.yaml under {source}. Is listing_catalog right?"

# Fresh copy each run, so files from an older version don't linger.
if os.path.exists(target):
    shutil.rmtree(target)
shutil.copytree(source, target)
print(f"Copied {source} -> {target}")

# COMMAND ----------

from databricks.sdk.errors import NotFound
from databricks.sdk.service.apps import App, AppDeployment

try:
    app = w.apps.get(app_name)
    print(f"Using existing app {app_name}")
except NotFound:
    print(f"Creating app {app_name} (takes a few minutes)...")
    app = w.apps.create_and_wait(
        app=App(name=app_name, description="Jobs and pipelines console: attention list, run timeline, run details")
    )

print("Deploying...")
deployment = w.apps.deploy_and_wait(
    app_name=app_name, app_deployment=AppDeployment(source_code_path=target)
)
app = w.apps.get(app_name)
print(f"Deployment: {deployment.status.state.value} - {deployment.status.message}")
print(f"App URL:    {app.url}")
print(f"Service principal (application id): {app.service_principal_client_id}")

# COMMAND ----------

from databricks.sdk.service.jobs import JobAccessControlRequest, JobPermissionLevel
from databricks.sdk.service.pipelines import PipelineAccessControlRequest, PipelinePermissionLevel

sp = app.service_principal_client_id

if not grant_view:
    print(
        "Skipped grants. The app shows only jobs and pipelines its service principal can view.\n"
        f"Grant CAN_VIEW to service principal {sp} on the ones it should show, "
        "or set grant_view = yes and run this cell again."
    )
else:
    granted, skipped = 0, 0
    for job in w.jobs.list():
        try:
            w.jobs.update_permissions(
                str(job.job_id),
                access_control_list=[
                    JobAccessControlRequest(service_principal_name=sp, permission_level=JobPermissionLevel.CAN_VIEW)
                ],
            )
            granted += 1
        except Exception:
            skipped += 1  # not a job you manage
    for pipeline in w.pipelines.list_pipelines():
        try:
            w.pipelines.update_permissions(
                pipeline.pipeline_id,
                access_control_list=[
                    PipelineAccessControlRequest(
                        service_principal_name=sp, permission_level=PipelinePermissionLevel.CAN_VIEW
                    )
                ],
            )
            granted += 1
        except Exception:
            skipped += 1
    print(f"Granted CAN_VIEW on {granted} jobs/pipelines; skipped {skipped} you don't manage.")
