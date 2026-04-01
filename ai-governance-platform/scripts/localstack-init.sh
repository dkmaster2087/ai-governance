#!/bin/bash
# Runs inside LocalStack on startup — creates all required AWS resources

set -e
REGION=us-east-1
ENDPOINT=http://localhost:4566
PREFIX=ai-gov
STAGE=dev
ACCOUNT=000000000000

echo "==> Creating DynamoDB tables..."

aws --endpoint-url=$ENDPOINT dynamodb create-table \
  --region $REGION \
  --table-name $PREFIX-tenants-$STAGE \
  --attribute-definitions AttributeName=tenantId,AttributeType=S \
  --key-schema AttributeName=tenantId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST || true

aws --endpoint-url=$ENDPOINT dynamodb create-table \
  --region $REGION \
  --table-name $PREFIX-policies-$STAGE \
  --attribute-definitions \
    AttributeName=tenantId,AttributeType=S \
    AttributeName=policyId,AttributeType=S \
  --key-schema \
    AttributeName=tenantId,KeyType=HASH \
    AttributeName=policyId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

aws --endpoint-url=$ENDPOINT dynamodb create-table \
  --region $REGION \
  --table-name $PREFIX-metrics-$STAGE \
  --attribute-definitions \
    AttributeName=tenantId,AttributeType=S \
    AttributeName=period,AttributeType=S \
  --key-schema \
    AttributeName=tenantId,KeyType=HASH \
    AttributeName=period,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

aws --endpoint-url=$ENDPOINT dynamodb create-table \
  --region $REGION \
  --table-name $PREFIX-compliance-$STAGE \
  --attribute-definitions \
    AttributeName=tenantId,AttributeType=S \
    AttributeName=framework,AttributeType=S \
  --key-schema \
    AttributeName=tenantId,KeyType=HASH \
    AttributeName=framework,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

aws --endpoint-url=$ENDPOINT dynamodb create-table \
  --region $REGION \
  --table-name $PREFIX-models-$STAGE \
  --attribute-definitions \
    AttributeName=tenantId,AttributeType=S \
    AttributeName=modelConfigId,AttributeType=S \
  --key-schema \
    AttributeName=tenantId,KeyType=HASH \
    AttributeName=modelConfigId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST || true

echo "==> Creating S3 buckets..."

aws --endpoint-url=$ENDPOINT s3 mb s3://$PREFIX-audit-logs-$STAGE-$ACCOUNT --region $REGION || true
aws --endpoint-url=$ENDPOINT s3 mb s3://$PREFIX-athena-results-$STAGE-$ACCOUNT --region $REGION || true

echo "==> Seeding sample tenant..."

aws --endpoint-url=$ENDPOINT dynamodb put-item \
  --region $REGION \
  --table-name $PREFIX-tenants-$STAGE \
  --item '{
    "tenantId": {"S": "tenant_demo"},
    "name": {"S": "Demo Corp"},
    "adminEmail": {"S": "admin@democorp.com"},
    "plan": {"S": "professional"},
    "status": {"S": "active"},
    "deploymentMode": {"S": "saas"},
    "region": {"S": "us-east-1"},
    "createdAt": {"S": "2026-01-01T00:00:00Z"},
    "updatedAt": {"S": "2026-01-01T00:00:00Z"},
    "settings": {"M": {
      "maxTokensPerRequest": {"N": "4096"},
      "maxRequestsPerMinute": {"N": "100"},
      "auditLogRetentionDays": {"N": "365"},
      "dataResidencyRegion": {"S": "us-east-1"},
      "piiMaskingEnabled": {"BOOL": true},
      "allowExternalProviders": {"BOOL": true},
      "allowedModels": {"L": []}
    }}
  }' || true

aws --endpoint-url=$ENDPOINT dynamodb put-item \
  --region $REGION \
  --table-name $PREFIX-tenants-$STAGE \
  --item '{
    "tenantId": {"S": "tenant_healthco"},
    "name": {"S": "HealthCo Systems"},
    "adminEmail": {"S": "admin@healthco.com"},
    "plan": {"S": "enterprise"},
    "status": {"S": "active"},
    "deploymentMode": {"S": "onprem"},
    "region": {"S": "us-east-1"},
    "createdAt": {"S": "2026-01-15T00:00:00Z"},
    "updatedAt": {"S": "2026-03-15T00:00:00Z"},
    "settings": {"M": {
      "maxTokensPerRequest": {"N": "2048"},
      "maxRequestsPerMinute": {"N": "200"},
      "auditLogRetentionDays": {"N": "2555"},
      "dataResidencyRegion": {"S": "us-east-1"},
      "piiMaskingEnabled": {"BOOL": true},
      "allowExternalProviders": {"BOOL": false},
      "allowedModels": {"L": []}
    }}
  }' || true

echo "==> Seeding demo model configurations..."

aws --endpoint-url=$ENDPOINT dynamodb put-item \
  --region $REGION \
  --table-name $PREFIX-models-$STAGE \
  --item '{
    "tenantId": {"S": "tenant_demo"},
    "modelConfigId": {"S": "model_claude_haiku"},
    "name": {"S": "Claude 3 Haiku (Fast)"},
    "provider": {"S": "bedrock"},
    "modelId": {"S": "anthropic.claude-3-haiku-20240307-v1:0"},
    "status": {"S": "active"},
    "isDefault": {"BOOL": true},
    "region": {"S": "us-east-1"},
    "maxTokensPerRequest": {"N": "4096"},
    "maxContextTokens": {"N": "200000"},
    "inputCostPer1kTokens": {"N": "0.00025"},
    "outputCostPer1kTokens": {"N": "0.00125"},
    "allowedForRoles": {"L": []},
    "allowedForApps": {"L": []},
    "requiresApproval": {"BOOL": false},
    "tags": {"L": [{"S": "fast"}, {"S": "cost-effective"}]},
    "createdAt": {"S": "2026-01-01T00:00:00Z"},
    "updatedAt": {"S": "2026-01-01T00:00:00Z"},
    "createdBy": {"S": "admin"}
  }' || true

aws --endpoint-url=$ENDPOINT dynamodb put-item \
  --region $REGION \
  --table-name $PREFIX-models-$STAGE \
  --item '{
    "tenantId": {"S": "tenant_demo"},
    "modelConfigId": {"S": "model_claude_sonnet"},
    "name": {"S": "Claude 3 Sonnet (Balanced)"},
    "provider": {"S": "bedrock"},
    "modelId": {"S": "anthropic.claude-3-sonnet-20240229-v1:0"},
    "status": {"S": "active"},
    "isDefault": {"BOOL": false},
    "region": {"S": "us-east-1"},
    "maxTokensPerRequest": {"N": "4096"},
    "maxContextTokens": {"N": "200000"},
    "inputCostPer1kTokens": {"N": "0.003"},
    "outputCostPer1kTokens": {"N": "0.015"},
    "allowedForRoles": {"L": []},
    "allowedForApps": {"L": []},
    "requiresApproval": {"BOOL": false},
    "tags": {"L": [{"S": "balanced"}]},
    "createdAt": {"S": "2026-01-01T00:00:00Z"},
    "updatedAt": {"S": "2026-01-01T00:00:00Z"},
    "createdBy": {"S": "admin"}
  }' || true

echo "==> Seeding sample policy (keyword block)..."

aws --endpoint-url=$ENDPOINT dynamodb put-item \
  --region $REGION \
  --table-name $PREFIX-policies-$STAGE \
  --item '{
    "tenantId": {"S": "tenant_demo"},
    "policyId": {"S": "policy_default"},
    "name": {"S": "Default Policy"},
    "description": {"S": "Block sensitive keywords"},
    "enabled": {"BOOL": true},
    "createdAt": {"S": "2026-01-01T00:00:00Z"},
    "updatedAt": {"S": "2026-01-01T00:00:00Z"},
    "createdBy": {"S": "admin"},
    "rules": {"L": [
      {"M": {
        "ruleId": {"S": "rule_keywords"},
        "type": {"S": "keyword_block"},
        "action": {"S": "block"},
        "priority": {"N": "1"},
        "enabled": {"BOOL": true},
        "description": {"S": "Block confidential keywords"},
        "config": {"M": {
          "keywords": {"L": [
            {"S": "confidential"},
            {"S": "top secret"},
            {"S": "internal only"}
          ]}
        }}
      }}
    ]}
  }' || true

echo "==> LocalStack init complete"
