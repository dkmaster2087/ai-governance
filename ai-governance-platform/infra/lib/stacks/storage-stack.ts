import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

interface StorageStackProps extends cdk.StackProps {
  prefix: string;
  stage: string;
}

export class StorageStack extends cdk.Stack {
  public readonly policiesTable: dynamodb.Table;
  public readonly metricsTable: dynamodb.Table;
  public readonly tenantsTable: dynamodb.Table;
  public readonly complianceTable: dynamodb.Table;
  public readonly modelsTable: dynamodb.Table;
  public readonly apiKeysTable: dynamodb.Table;
  public readonly alertsTable: dynamodb.Table;
  public readonly shadowAiTable: dynamodb.Table;
  public readonly auditLogsTable: dynamodb.Table;
  public readonly auditLogBucket: s3.Bucket;
  public readonly athenaBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { prefix, stage } = props;

    // Production data is kept when a stack is deleted; dev/test stacks clean up after themselves.

    const removalPolicy = stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // KMS key for encryption at rest
    const kmsKey = new kms.Key(this, 'StorageKey', {
      alias: `${prefix}-storage-${stage}`,
      enableKeyRotation: true,
      description: 'AI Governance Platform storage encryption key',
      removalPolicy,
    });

    // Tenants table
    this.tenantsTable = new dynamodb.Table(this, 'TenantsTable', {
      tableName: `${prefix}-tenants-${stage}`,
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      pointInTimeRecovery: true,
      removalPolicy,
    });

    // Policies table (tenantId + policyId)
    this.policiesTable = new dynamodb.Table(this, 'PoliciesTable', {
      tableName: `${prefix}-policies-${stage}`,
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'policyId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      pointInTimeRecovery: true,
      removalPolicy,
    });

    // Metrics table (tenantId + period)
    this.metricsTable = new dynamodb.Table(this, 'MetricsTable', {
      tableName: `${prefix}-metrics-${stage}`,
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'period', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      timeToLiveAttribute: 'ttl',
      removalPolicy,
    });

    // Compliance state table (tenantId + framework)
    this.complianceTable = new dynamodb.Table(this, 'ComplianceTable', {
      tableName: `${prefix}-compliance-${stage}`,
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'framework', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      removalPolicy,
    });

    // Model configurations table (tenantId + modelConfigId)
    this.modelsTable = new dynamodb.Table(this, 'ModelsTable', {
      tableName: `${prefix}-models-${stage}`,
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'modelConfigId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      removalPolicy,
    });

    // API Keys table (tenantId + keyId) with GSI on keyHash for auth lookups
    this.apiKeysTable = new dynamodb.Table(this, 'ApiKeysTable', {
      tableName: `${prefix}-api-keys-${stage}`,
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'keyId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      pointInTimeRecovery: true,
      removalPolicy,
    });
    this.apiKeysTable.addGlobalSecondaryIndex({
      indexName: 'keyHash-index',
      partitionKey: { name: 'keyHash', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Alerts table (tenantId + ruleId)
    this.alertsTable = new dynamodb.Table(this, 'AlertsTable', {
      tableName: `${prefix}-alerts-${stage}`,
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'ruleId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      removalPolicy,
    });

    // Shadow AI events table (tenantId + eventId)
    this.shadowAiTable = new dynamodb.Table(this, 'ShadowAiTable', {
      tableName: `${prefix}-shadow-ai-${stage}`,
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      timeToLiveAttribute: 'ttl',
      removalPolicy,
    });

    // Audit logs table (tenantId + requestId) with TTL for retention
    this.auditLogsTable = new dynamodb.Table(this, 'AuditLogsTable', {
      tableName: `${prefix}-audit-logs-${stage}`,
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'requestId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
      removalPolicy,
    });

    // The dashboard's summaries read audit records for a tenant by time.
    this.auditLogsTable.addGlobalSecondaryIndex({
      indexName: 'tenantId-timestamp-index',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Audit log bucket (immutable, versioned, encrypted)
    this.auditLogBucket = new s3.Bucket(this, 'AuditLogBucket', {
      bucketName: `${prefix}-audit-logs-${stage}-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectLockEnabled: true, // Immutable audit logs
      lifecycleRules: [
        {
          id: 'TransitionToIA',
          transitions: [{ storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: cdk.Duration.days(30) }],
        },
        {
          id: 'TransitionToGlacier',
          transitions: [{ storageClass: s3.StorageClass.GLACIER, transitionAfter: cdk.Duration.days(90) }],
        },
      ],
      removalPolicy,
      autoDeleteObjects: stage !== 'prod', // Empty buckets on teardown, except in production
    });

    // Athena results bucket
    this.athenaBucket = new s3.Bucket(this, 'AthenaBucket', {
      bucketName: `${prefix}-athena-results-${stage}-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        { expiration: cdk.Duration.days(7) }, // Auto-clean query results
      ],
      removalPolicy,
      autoDeleteObjects: stage !== 'prod',
    });

    // Outputs
    new cdk.CfnOutput(this, 'AuditBucketName', { value: this.auditLogBucket.bucketName });
    new cdk.CfnOutput(this, 'PoliciesTableName', { value: this.policiesTable.tableName });
    new cdk.CfnOutput(this, 'TenantsTableName', { value: this.tenantsTable.tableName });
  }
}
