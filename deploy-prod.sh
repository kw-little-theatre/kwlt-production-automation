#!/bin/bash
# Deploy kwlt-slack-service with correct service account for production
# Run from slack-service directory

cd "$(dirname "$0")/slack-service"

gcloud run deploy kwlt-slack-service \
  --source . \
  --project=kwlt-slackbot \
  --region=us-east1 \
  --service-account=kwlt-slackbot@kwlt-slackbot.iam.gserviceaccount.com

echo ""
echo "Deployment complete. Verifying service account..."
gcloud run services describe kwlt-slack-service \
  --region=us-east1 \
  --format='value(spec.template.spec.serviceAccountName)'
