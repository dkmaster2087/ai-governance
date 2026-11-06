import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/stacks/network-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { ServicesStack } from '../lib/stacks/services-stack';

describe('ServicesStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App({ context: { gatewayUrl: 'https://gateway.acme.example' } });
    const env = { account: '123456789012', region: 'us-east-1' };
    const base = { env, prefix: 'ai-gov', stage: 'test' };
    const network = new NetworkStack(app, 'Net', base);
    const storage = new StorageStack(app, 'Store', base);
    const auth = new AuthStack(app, 'Auth', base);
    const stack = new ServicesStack(app, 'Services', {
      ...base, vpc: network.vpc, policiesTable: storage.policiesTable, metricsTable: storage.metricsTable,
      auditLogBucket: storage.auditLogBucket, userPool: auth.userPool, userPoolClient: auth.userPoolClient,
      apiKeysTable: storage.apiKeysTable, alertsTable: storage.alertsTable, shadowAiTable: storage.shadowAiTable,
      auditLogsTable: storage.auditLogsTable, modelsTable: storage.modelsTable, complianceTable: storage.complianceTable,
      tenantsTable: storage.tenantsTable,
    });
    template = Template.fromStack(stack);
  });

  it('runs four services', () => {
    template.resourceCountIs('AWS::ECS::Service', 4);
  });

  it('routes the gateway to the policy engine and data protection through the internal load balancer', () => {
    for (const port of [3001, 3002, 3003]) {
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', { Port: port, Protocol: 'HTTP' });
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', { Port: port, TargetType: 'ip', HealthCheckPath: '/health' });
    }
    // Policy engine and data protection services are registered with their target groups.
    const services = template.findResources('AWS::ECS::Service');
    const withLb = Object.values(services).filter((s: any) => (s.Properties.LoadBalancers ?? []).length > 0);
    expect(withLb).toHaveLength(4); // gateway (public); policy engine, data protection and analytics (internal)
  });

  it('gives only the gateway and analytics the internal key, from Secrets Manager', () => {
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
    const defs = Object.values(template.findResources('AWS::ECS::TaskDefinition')) as any[];
    const withKey = defs.filter((d) => d.Properties.ContainerDefinitions.some((c: any) => (c.Secrets ?? []).some((x: any) => x.Name === 'INTERNAL_SERVICE_KEY')));
    expect(withKey.map((d) => d.Properties.ContainerDefinitions[0].Name).sort()).toEqual(['AnalyticsContainer', 'GatewayContainer']);
    // No key in plain environment variables.
    expect(JSON.stringify(defs)).not.toMatch(/"Name":"INTERNAL_SERVICE_KEY","Value"/);
  });

  it('tells the gateway its public address and where analytics is', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([Match.objectLike({ Environment: Match.arrayWith([Match.objectLike({ Name: 'ANALYTICS_URL' })]) })]),
    });
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([Match.objectLike({
        Environment: Match.arrayWith([{ Name: 'PUBLIC_GATEWAY_URL', Value: 'https://gateway.acme.example' }]),
      })]),
    });
  });
});
