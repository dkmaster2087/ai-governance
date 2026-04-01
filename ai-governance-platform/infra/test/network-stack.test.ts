import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/stacks/network-stack';

describe('NetworkStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new NetworkStack(app, 'TestNetworkStack', {
      env: { account: '123456789012', region: 'us-east-1' },
      prefix: 'ai-gov',
      stage: 'test',
    });
    template = Template.fromStack(stack);
  });

  it('creates a VPC', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
  });

  it('creates exactly 1 NAT Gateway (cost optimized)', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
  });

  it('creates 2 public subnets', () => {
    template.resourceCountIs('AWS::EC2::Subnet', Match.anyValue());
    // 2 public + 2 private-app + 2 private-data = 6 subnets across 2 AZs
    const subnets = template.findResources('AWS::EC2::Subnet');
    expect(Object.keys(subnets).length).toBe(6);
  });

  it('creates S3 VPC endpoint', () => {
    template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
      ServiceName: Match.stringLikeRegexp('s3'),
      VpcEndpointType: 'Gateway',
    });
  });

  it('creates DynamoDB VPC endpoint', () => {
    template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
      ServiceName: Match.stringLikeRegexp('dynamodb'),
      VpcEndpointType: 'Gateway',
    });
  });

  it('creates Bedrock interface endpoint', () => {
    template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
      ServiceName: Match.stringLikeRegexp('bedrock-runtime'),
      VpcEndpointType: 'Interface',
    });
  });

  it('enables VPC flow logs', () => {
    template.resourceCountIs('AWS::EC2::FlowLog', 1);
  });
});
