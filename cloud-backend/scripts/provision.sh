#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:?usage: provision.sh PROJECT_ID [REGION]}"
REGION="${2:-asia-southeast1}"
RUNTIME_SA="henry-runtime@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "${PROJECT_ID}"
gcloud services enable \
  aiplatform.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  cloudresourcemanager.googleapis.com \
  firestore.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  cloudtasks.googleapis.com \
  calendar-json.googleapis.com

gcloud iam service-accounts describe "${RUNTIME_SA}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create henry-runtime --display-name="Henry runtime"

for role in roles/aiplatform.user roles/datastore.user roles/cloudtasks.enqueuer roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="${role}" \
    --quiet
done

# Cloud Tasks needs permission to mint the OIDC identity attached to worker calls.
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --quiet

gcloud tasks queues describe henry-workflows --location="${REGION}" >/dev/null 2>&1 || \
  gcloud tasks queues create henry-workflows \
    --location="${REGION}" \
    --max-concurrent-dispatches=5 \
    --max-attempts=3 \
    --min-backoff=5s \
    --max-backoff=60s

gcloud firestore databases describe --project="${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud firestore databases create --project="${PROJECT_ID}" --location="${REGION}"

echo "Provisioned Henry prerequisites in ${PROJECT_ID}/${REGION}."
echo "Next: create the OAuth token secret, then run deploy.sh."
