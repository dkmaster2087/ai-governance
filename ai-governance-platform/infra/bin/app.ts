import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/stacks/network-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { ServicesStack } from '../lib/stacks/services-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { ObservabilityStack } from '../lib/stacks/observability-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

const prefix = app.node.tryGetContext('prefix') || 'ai-gov';
const stage = app.node.tryGetContext('stage') || 'dev';

// 1. Network (VPC: 2 public + 4 private subnets, single NAT GW)
const networkStack = new NetworkStack(app, `${prefix}-network-${stage}`, {
  env,
  prefix,
  stage,
});

// 2. Storage (DynamoDB + S3)
const storageStack = new StorageStack(app, `${prefix}-storage-${stage}`, {
  env,
  prefix,
  stage,
});

// 3. Auth (Cognito for SaaS, IAM for on-prem)
const authStack = new AuthStack(app, `${prefix}-auth-${stage}`, {
  env,
  prefix,
  stage,
});

// 4. Observability (CloudWatch dashboards, Athena)
const observabilityStack = new ObservabilityStack(app, `${prefix}-observability-${stage}`, {
  env,
  prefix,
  stage,
  auditLogBucket: storageStack.auditLogBucket,
});

// 5. ECS Services
const servicesStack = new ServicesStack(app, `${prefix}-services-${stage}`, {
  env,
  prefix,
  stage,
  vpc: networkStack.vpc,
  policiesTable: storageStack.policiesTable,
  metricsTable: storageStack.metricsTable,
  auditLogBucket: storageStack.auditLogBucket,
  userPool: authStack.userPool,
});

// 6. API Gateway
const apiStack = new ApiStack(app, `${prefix}-api-${stage}`, {
  env,
  prefix,
  stage,
  gatewayService: servicesStack.gatewayService,
  userPool: authStack.userPool,
});

// Explicit dependency ordering
storageStack.addDependency(networkStack);
authStack.addDependency(networkStack);
observabilityStack.addDependency(storageStack);
servicesStack.addDependency(storageStack);
servicesStack.addDependency(authStack);
apiStack.addDependency(servicesStack);

cdk.Tags.of(app).add('Project', 'ai-governance-platform');
cdk.Tags.of(app).add('Stage', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
