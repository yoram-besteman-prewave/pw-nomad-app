#!/bin/bash
set -e

# ===========================================
# NoMAD Deployment Script for Google Cloud Run
# Builds x86_64 (linux/amd64) container
# ===========================================

PROJECT_ID="pw-nomad-app-jmgr8u"
REGION="europe-west1"
SERVICE_NAME="nomad"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"
CLOUD_SQL_INSTANCE="${PROJECT_ID}:europe-west6:nomad-db"

SECRET_DATABASE_URL="${SECRET_DATABASE_URL:-nomad-database-url}"
SECRET_ATLASSIAN_OAUTH_CLIENT_ID="${SECRET_ATLASSIAN_OAUTH_CLIENT_ID:-nomad-atlassian-oauth-client-id}"
SECRET_ATLASSIAN_OAUTH_CLIENT_SECRET="${SECRET_ATLASSIAN_OAUTH_CLIENT_SECRET:-nomad-atlassian-oauth-client-secret}"
SECRET_OKTA_CLIENT_ID="${SECRET_OKTA_CLIENT_ID:-nomad-okta-client-id}"
SECRET_OKTA_CLIENT_SECRET="${SECRET_OKTA_CLIENT_SECRET:-nomad-okta-client-secret}"
OKTA_DOMAIN="${OKTA_DOMAIN:-prewave.okta.com}"

echo "╔════════════════════════════════════════╗"
echo "║        NoMAD Deployment Script         ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Check if running on ARM (M1/M2 Mac) - need to cross-compile
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
    echo "⚠️  Detected ARM architecture (Apple Silicon)"
    echo "   Building for linux/amd64 (Cloud Run)..."
    PLATFORM_FLAG="--platform linux/amd64"
else
    echo "✓  Detected x86 architecture"
    PLATFORM_FLAG=""
fi

echo ""
echo "🏗️  Building Docker image for x86_64..."
docker build $PLATFORM_FLAG -t ${IMAGE_NAME}:latest .

echo ""
echo "📤 Pushing to Google Container Registry..."
docker push ${IMAGE_NAME}:latest

echo ""
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
    --image ${IMAGE_NAME}:latest \
    --platform managed \
    --region ${REGION} \
    --project ${PROJECT_ID} \
    --allow-unauthenticated \
    --set-env-vars "BASE_URL=https://nomad.it.prewave.ai" \
    --set-env-vars "OKTA_DOMAIN=${OKTA_DOMAIN}" \
    --set-secrets "DATABASE_URL=${SECRET_DATABASE_URL}:latest" \
    --set-secrets "ATLASSIAN_OAUTH_CLIENT_ID=${SECRET_ATLASSIAN_OAUTH_CLIENT_ID}:latest" \
    --set-secrets "ATLASSIAN_OAUTH_CLIENT_SECRET=${SECRET_ATLASSIAN_OAUTH_CLIENT_SECRET}:latest" \
    --set-secrets "OKTA_CLIENT_ID=${SECRET_OKTA_CLIENT_ID}:latest" \
    --set-secrets "OKTA_CLIENT_SECRET=${SECRET_OKTA_CLIENT_SECRET}:latest" \
    --add-cloudsql-instances ${CLOUD_SQL_INSTANCE} \
    --memory 512Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 3 \
    --timeout 60 \
    --concurrency 100

echo ""
echo "╔════════════════════════════════════════╗"
echo "║         ✅ Deployment Complete!        ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "🌐 URL: https://nomad.it.prewave.ai"
echo ""
