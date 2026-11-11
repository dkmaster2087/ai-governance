#!/bin/bash
# Probaline collector for Google Cloud: a Cloud Run job, run hourly by Cloud Scheduler, that reads the log files
# a Cloud Logging sink writes to a bucket, keeps AI matches only, and writes results and the report to a new
# bucket. It runs as its own service account: read-only on the logs bucket, write on the results bucket.
# Nothing leaves your project.
#
#   PROJECT=acme-prod REGION=us-central1 IMAGE=us-central1-docker.pkg.dev/acme-prod/tools/probaline-collector:0.1.0 \
#   LOG_BUCKET=acme-ai-logs [CREATE_SINKS=1] [IGNORE=…] [GATEWAY=ip:203.0.113.4] [COMPANY=Acme] collector/deploy/gcp/deploy.sh
#
# CREATE_SINKS=1 also creates the log sinks (Cloud DNS queries, Secure Web Proxy, and Vertex AI / Gemini API
# data access audit logs) into LOG_BUCKET. Data access audit logs must be turned on for aiplatform.googleapis.com
# and generativelanguage.googleapis.com (IAM → Audit Logs) for model calls to appear.
set -euo pipefail

: "${PROJECT:?set PROJECT}" "${REGION:?set REGION}" "${IMAGE:?set IMAGE}" "${LOG_BUCKET:?set LOG_BUCKET}"
RESULTS_BUCKET="${RESULTS_BUCKET:-${PROJECT}-probaline-results}"
SA_NAME=probaline-collector
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
JOB=probaline-collector
gc() { gcloud --project "$PROJECT" --quiet "$@"; }

echo "==> Service account"
gc iam service-accounts describe "$SA" >/dev/null 2>&1 || gc iam service-accounts create "$SA_NAME" --display-name "Probaline collector (read-only on logs)"

echo "==> Results bucket gs://$RESULTS_BUCKET (private, uniform access)"
gc storage buckets describe "gs://$RESULTS_BUCKET" >/dev/null 2>&1 || \
  gc storage buckets create "gs://$RESULTS_BUCKET" --location "$REGION" --uniform-bucket-level-access --public-access-prevention
gc storage buckets add-iam-policy-binding "gs://$RESULTS_BUCKET" --member "serviceAccount:$SA" --role roles/storage.objectAdmin >/dev/null
gc storage buckets add-iam-policy-binding "gs://$LOG_BUCKET" --member "serviceAccount:$SA" --role roles/storage.objectViewer >/dev/null

if [ "${CREATE_SINKS:-0}" = "1" ]; then
  echo "==> Log sinks into gs://$LOG_BUCKET"
  sink() {
    local name=$1 filter=$2
    if ! gc logging sinks describe "$name" >/dev/null 2>&1; then
      gc logging sinks create "$name" "storage.googleapis.com/$LOG_BUCKET" --log-filter "$filter"
    fi
    local writer
    writer=$(gc logging sinks describe "$name" --format 'value(writerIdentity)')
    gc storage buckets add-iam-policy-binding "gs://$LOG_BUCKET" --member "$writer" --role roles/storage.objectCreator >/dev/null
  }
  sink probaline-dns 'resource.type="dns_query"'
  sink probaline-web-proxy 'resource.type="networkservices.googleapis.com/Gateway"'
  sink probaline-ai-audit 'logName:"cloudaudit.googleapis.com%2Fdata_access" AND (protoPayload.serviceName="aiplatform.googleapis.com" OR protoPayload.serviceName="generativelanguage.googleapis.com")'
fi

echo "==> Cloud Run job $JOB"
# "^@^" makes @ the separator, so comma-separated lists (IGNORE, GATEWAY) stay whole (gcloud topic escaping).
ENV="^@^CLOUD=gcp@LOG_BUCKETS=$LOG_BUCKET@RESULTS_BUCKET=$RESULTS_BUCKET@IGNORE=${IGNORE:-}@GATEWAY=${GATEWAY:-}@COMPANY=${COMPANY:-}"
if gc run jobs describe "$JOB" --region "$REGION" >/dev/null 2>&1; then
  gc run jobs update "$JOB" --region "$REGION" --image "$IMAGE" --service-account "$SA" --set-env-vars "$ENV" \
    --args cloud-job --task-timeout 3600 --max-retries 1 --memory 1Gi
else
  gc run jobs create "$JOB" --region "$REGION" --image "$IMAGE" --service-account "$SA" --set-env-vars "$ENV" \
    --args cloud-job --task-timeout 3600 --max-retries 1 --memory 1Gi
fi

echo "==> Hourly schedule"
gc run jobs add-iam-policy-binding "$JOB" --region "$REGION" --member "serviceAccount:$SA" --role roles/run.invoker >/dev/null
URI="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/$JOB:run"
if gc scheduler jobs describe "$JOB" --location "$REGION" >/dev/null 2>&1; then
  gc scheduler jobs update http "$JOB" --location "$REGION" --schedule "15 * * * *" --uri "$URI" --http-method POST --oauth-service-account-email "$SA"
else
  gc scheduler jobs create http "$JOB" --location "$REGION" --schedule "15 * * * *" --uri "$URI" --http-method POST --oauth-service-account-email "$SA"
fi

echo
echo "Done. Run it now:   gcloud run jobs execute $JOB --project $PROJECT --region $REGION"
echo "Report:             gs://$RESULTS_BUCKET/reports/latest.html"
