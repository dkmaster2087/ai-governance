import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/stacks/network-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

const build = (context: Record<string, string> = {}, stage = 'test') => {
  const app = new cdk.App({ context });
  const env = { account: '123456789012', region: 'us-east-1' };
  const net = new NetworkStack(app, 'Net', { env, prefix: 'ai-gov', stage });
  const lbStack = new cdk.Stack(app, 'Lb', { env });
  const lb = new elbv2.ApplicationLoadBalancer(lbStack, 'Alb', { vpc: net.vpc, internetFacing: true });
  return Template.fromStack(new FrontendStack(app, 'Front', { env, prefix: 'ai-gov', stage, loadBalancer: lb }));
};

describe('FrontendStack', () => {
  it('hosts the website, dashboard and docs privately behind CloudFront', () => {
    const t = build();
    t.resourceCountIs('AWS::CloudFront::Distribution', 3);
    t.resourceCountIs('AWS::S3::Bucket', 3);
    t.allResourcesProperties('AWS::S3::Bucket', { PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true } });
  });

  it('sends /api/* from the dashboard and website to the gateway, uncached, but not from the docs', () => {
    const t = build({ gatewayUrl: 'https://gateway.acme.example' });
    const dists = Object.values(t.findResources('AWS::CloudFront::Distribution')) as any[];
    const withApi = dists.filter((d) => (d.Properties.DistributionConfig.CacheBehaviors ?? []).some((b: any) => b.PathPattern === '/api/*'));
    expect(withApi).toHaveLength(2);
    const origins = JSON.stringify(withApi[0].Properties.DistributionConfig.Origins);
    expect(origins).toContain('gateway.acme.example');
    expect(origins).toContain('https-only');
  });

  it('uses custom domains when given, and refuses production without an https gateway', () => {
    const t = build({ dashboardDomain: 'app.acme.example', cloudfrontCertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/x', gatewayUrl: 'https://gw.acme.example' });
    t.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: Match.objectLike({ Aliases: ['app.acme.example'] }) });
    expect(() => build({}, 'prod')).toThrow(/gatewayUrl/);
  });
});
