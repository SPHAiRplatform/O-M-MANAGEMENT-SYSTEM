#!/bin/bash

# SPHAiRDigital Deployment Script
# Usage: ./scripts/deploy.sh <environment> <version> [service-token]

set -e

ENVIRONMENT=${1:-staging}
VERSION=${2:-latest}
SERVICE_TOKEN=${3:-$PLATFORM_SERVICE_TOKEN}

if [ -z "$SERVICE_TOKEN" ]; then
  echo "Error: Service token required"
  echo "Usage: ./scripts/deploy.sh <environment> <version> [service-token]"
  echo "Or set PLATFORM_SERVICE_TOKEN environment variable"
  exit 1
fi

# Configuration
DEPLOYMENT_CONFIG=".deployment/${ENVIRONMENT}.env"

if [ ! -f "$DEPLOYMENT_CONFIG" ]; then
  echo "Error: Deployment config not found: $DEPLOYMENT_CONFIG"
  exit 1
fi

# Load deployment config
source "$DEPLOYMENT_CONFIG"

SERVER_URL=${SERVER_URL:-http://localhost:3001}

echo "=========================================="
echo "SPHAiRDigital Deployment"
echo "=========================================="
echo "Environment: $ENVIRONMENT"
echo "Version: $VERSION"
echo "Server: $SERVER_URL"
echo "=========================================="

# Check current version
echo "Checking current version..."
CURRENT_VERSION=$(curl -s "${SERVER_URL}/api/platform/version" | jq -r '.version')
echo "Current version: $CURRENT_VERSION"

# Apply update
echo "Applying update..."
RESPONSE=$(curl -s -X POST "${SERVER_URL}/api/platform/updates/apply" \
  -H "Content-Type: application/json" \
  -H "X-Platform-Service-Token: ${SERVICE_TOKEN}" \
  -d "{
    \"version\": \"${VERSION}\",
    \"updateType\": \"patch\"
  }")

echo "$RESPONSE" | jq '.'

UPDATE_ID=$(echo "$RESPONSE" | jq -r '.updateId')

if [ "$UPDATE_ID" == "null" ] || [ -z "$UPDATE_ID" ]; then
  echo "Error: Failed to initiate update"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo "Update ID: $UPDATE_ID"
echo "Monitoring update status..."

# Monitor update progress
while true; do
  STATUS_RESPONSE=$(curl -s -X GET "${SERVER_URL}/api/platform/updates/status/${UPDATE_ID}" \
    -H "X-Platform-Service-Token: ${SERVICE_TOKEN}")

  STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status')
  ERROR=$(echo "$STATUS_RESPONSE" | jq -r '.error_message // empty')

  echo "Status: $STATUS"

  if [ "$STATUS" == "completed" ]; then
    echo "=========================================="
    echo "Update completed successfully!"
    echo "=========================================="
    break
  elif [ "$STATUS" == "failed" ]; then
    echo "=========================================="
    echo "Update failed!"
    echo "Error: $ERROR"
    echo "=========================================="
    exit 1
  fi

  sleep 5
done

# Verify deployment
echo "Verifying deployment..."
HEALTH=$(curl -s "${SERVER_URL}/api/platform/health")
HEALTH_STATUS=$(echo "$HEALTH" | jq -r '.status')

if [ "$HEALTH_STATUS" == "healthy" ]; then
  echo "Deployment verified: Healthy"
  NEW_VERSION=$(echo "$HEALTH" | jq -r '.version')
  echo "New version: $NEW_VERSION"
else
  echo "Warning: Health check returned unhealthy status"
  echo "$HEALTH" | jq '.'
  exit 1
fi

echo "=========================================="
echo "Deployment complete!"
echo "=========================================="
