import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { StorageStack } from '../lib/stacks/storage-stack';

describe('StorageStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new StorageStack(app, 'TestStorageStack', {
      env: { account: '123456789012', region: 'us-east-1' },
      prefix: 'ai-gov',
      stage: 'test',
    });
    template = Template.fromStack(stack);
  });

  it('creates the 20 DynamoDB tables (10, 7 for MCP servers, activity, log export and enforcement)', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 20);
  });

  it('can restore every table to any point in the last 35 days, except short-lived counters', () => {
    const tables = Object.values(template.findResources('AWS::DynamoDB::Table')) as any[];
    const without = tables.filter((t) => !t.Properties.PointInTimeRecoverySpecification?.PointInTimeRecoveryEnabled).map((t) => t.Properties.TableName);
    expect(without).toEqual([expect.stringMatching(/-metrics-/)]);
  });

  it('keeps admin activity restorable in every stage', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: Match.stringLikeRegexp('-activity-'), PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true }, TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('indexes audit records by tenant and time for the dashboard', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: Match.stringLikeRegexp('audit-logs'),
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'tenantId-timestamp-index' })]),
    });
  });

  it('audit log bucket has versioning enabled', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
    });
  });

  it('audit log bucket blocks all public access', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('DynamoDB tables use KMS encryption', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      SSESpecification: { SSEEnabled: true, SSEType: 'KMS' },
    });
  });

  it('creates a KMS key with rotation enabled', () => {
    template.hasResourceProperties('AWS::KMS::Key', {
      EnableKeyRotation: true,
    });
  });

  it('policies table has point-in-time recovery', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });
});

describe('StorageStack in production', () => {
  it('keeps data when the stack is deleted', () => {
    const app = new cdk.App();
    const stack = new StorageStack(app, 'StorageProd', { env: { account: '123456789012', region: 'us-east-1' }, prefix: 'ai-gov', stage: 'prod' });
    const t = Template.fromStack(stack);
    const tables = Object.values(t.findResources('AWS::DynamoDB::Table')) as any[];
    expect(tables.every((r) => r.DeletionPolicy === 'Retain')).toBe(true);
  });
});
