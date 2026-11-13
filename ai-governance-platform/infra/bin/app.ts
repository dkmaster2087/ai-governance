import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/stacks/network-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { ServicesStack } from '../lib/stacks/services-stack';
import { RegistryStack } from '../lib/stacks/registry-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';
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

// 0. Image repositories (deployed first, before images are pushed)
const registryStack = new RegistryStack(app, `${prefix}-registry-${stage}`, { env, prefix, stage });

// 5. ECS Services
const servicesStack = new ServicesStack(app, `${prefix}-services-${stage}`, {
  env,
  prefix,
  stage,
  vpc: networkStack.vpc,
  repositories: registryStack.repositories,
  policiesTable: storageStack.policiesTable,
  metricsTable: storageStack.metricsTable,
  auditLogBucket: storageStack.auditLogBucket,
  storageKey: storageStack.storageKey,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  apiKeysTable: storageStack.apiKeysTable,
  alertsTable: storageStack.alertsTable,
  shadowAiTable: storageStack.shadowAiTable,
  mcpTables: {
    servers: storageStack.mcpServersTable, apis: storageStack.mcpApisTable, tools: storageStack.mcpToolsTable,
    versions: storageStack.mcpVersionsTable, approvals: storageStack.mcpApprovalsTable,
    oauth: storageStack.mcpOauthTable, connectors: storageStack.mcpConnectorsTable,
  },
  logTables: { activity: storageStack.activityTable, logExport: storageStack.logExportTable, enforcement: storageStack.enforcementTable, catalog: storageStack.catalogTable },
  egressAddresses: networkStack.natAddresses,
  auditLogsTable: storageStack.auditLogsTable,
  modelsTable: storageStack.modelsTable,
  complianceTable: storageStack.complianceTable,
  tenantsTable: storageStack.tenantsTable,
  usersTable: storageStack.usersTable,
});


// 4. Observability (CloudWatch dashboards, Athena)
const observabilityStack = new ObservabilityStack(app, `${prefix}-observability-${stage}`, {
  env,
  prefix,
  stage,
  auditLogBucket: storageStack.auditLogBucket,
  loadBalancer: servicesStack.loadBalancer,
  // Where alarms are emailed: -c alarmEmail=ops@example.com (optional; the topic can be subscribed to later)
  alarmEmail: app.node.tryGetContext('alarmEmail'),
});

// 6. Website, dashboard and docs (CloudFront); /api/* goes to the gateway
const frontendStack = new FrontendStack(app, `${prefix}-frontend-${stage}`, { env, prefix, stage, loadBalancer: servicesStack.loadBalancer, edgeSecret: servicesStack.edgeSecret });

// Explicit dependency ordering
storageStack.addDependency(networkStack);
authStack.addDependency(networkStack);
observabilityStack.addDependency(storageStack);
servicesStack.addDependency(storageStack);
servicesStack.addDependency(authStack);
servicesStack.addDependency(registryStack);
frontendStack.addDependency(servicesStack);

cdk.Tags.of(app).add('Project', 'ai-governance-platform');
cdk.Tags.of(app).add('Stage', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
