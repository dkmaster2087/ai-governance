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
  public readonly auditLogBucket: s3.Bucket;
  public readonly athenaBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { prefix, stage } = props;

    // KMS key for encryption at rest
    const kmsKey = new kms.Key(this, 'StorageKey', {
      alias: `${prefix}-storage-${stage}`,
      enableKeyRotation: true,
      description: 'AI Governance Platform storage encryption key',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
    });

    // Tenants table
    this.tenantsTable = new dynamodb.Table(this, 'TenantsTable', {
      tableName: `${prefix}-tenants-${stage}`,
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
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
      removalPolicy: cdk.RemovalPolicy.DESTROY,
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
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Compliance state table (tenantId + framework)
    this.complianceTable = new dynamodb.Table(this, 'ComplianceTable', {
      tableName: `${prefix}-compliance-${stage}`,
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'framework', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Model configurations table (tenantId + modelConfigId)
    this.modelsTable = new dynamodb.Table(this, 'ModelsTable', {
      tableName: `${prefix}-models-${stage}`,
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'modelConfigId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
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
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true, // For teardown convenience in dev
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
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Outputs
    new cdk.CfnOutput(this, 'AuditBucketName', { value: this.auditLogBucket.bucketName });
    new cdk.CfnOutput(this, 'PoliciesTableName', { value: this.policiesTable.tableName });
    new cdk.CfnOutput(this, 'TenantsTableName', { value: this.tenantsTable.tableName });
  }
}
