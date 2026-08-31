#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:?usage: deploy.sh PROJECT_ID [REGION] [DASHBOARD_ORIGIN]}"
REGION="${2:-asia-southeast1}"
DASHBOARD_ORIGIN="${3:-https://henry-taskmaster.karndanai537.chatgpt.site}"
RUNTIME_SA="henry-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
OAUTH_SECRET_NAME="${HENRY_OAUTH_SECRET_NAME:-henry-google-oauth-token}"
COMMON_ENV="HENRY_ENVIRONMENT=production,HENRY_MODEL=gemini-3.5-flash,HENRY_PLANNER=adk,HENRY_REPOSITORY=firestore,HENRY_TOOL_MODE=calendar,HENRY_ALLOWED_ORIGINS=[\"${DASHBOARD_ORIGIN}\"],GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_ENTERPRISE=True,HENRY_CLOUD_REGION=${REGION},HENRY_TASK_QUEUE=henry-workflows,HENRY_TASK_SERVICE_ACCOUNT=${RUNTIME_SA},HENRY_TIMEZONE=Asia/Bangkok"
COMMON_SECRETS="HENRY_GOOGLE_OAUTH_TOKEN_JSON=${OAUTH_SECRET_NAME}:latest"

if ! gcloud secrets describe "${OAUTH_SECRET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Missing Secret Manager secret: ${OAUTH_SECRET_NAME}"
  echo "Create it from cloud-backend/oauth-token.json before deploying."
  exit 1
fi

gcloud run deploy henry-worker \
  --source . \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --service-account="${RUNTIME_SA}" \
  --no-allow-unauthenticated \
  --cpu=1 \
  --memory=512Mi \
  --min=0 \
  --max=3 \
  --set-secrets="${COMMON_SECRETS}" \
  --set-env-vars="${COMMON_ENV},HENRY_SERVICE_ROLE=worker,HENRY_DISPATCHER=local"

WORKER_URL="$(gcloud run services describe henry-worker \
  --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.url)')"

gcloud run services update henry-worker \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --update-env-vars="HENRY_DISPATCHER=cloud_tasks,HENRY_SERVICE_URL=${WORKER_URL}"

gcloud run services add-iam-policy-binding henry-worker \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/run.invoker"

gcloud run deploy henry-api \
  --source . \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --service-account="${RUNTIME_SA}" \
  --allow-unauthenticated \
  --cpu=1 \
  --memory=512Mi \
  --min=0 \
  --max=5 \
  --set-secrets="${COMMON_SECRETS}" \
  --set-env-vars="${COMMON_ENV},HENRY_SERVICE_ROLE=api,HENRY_DISPATCHER=cloud_tasks,HENRY_SERVICE_URL=${WORKER_URL}"

gcloud run services describe henry-api \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)'
