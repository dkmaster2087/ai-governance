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

  it('creates the 9 DynamoDB tables', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 9);
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
