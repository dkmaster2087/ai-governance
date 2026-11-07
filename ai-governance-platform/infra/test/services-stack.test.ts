import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/stacks/network-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { ServicesStack } from '../lib/stacks/services-stack';
import { RegistryStack } from '../lib/stacks/registry-stack';

describe('ServicesStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App({ context: { gatewayUrl: 'https://gateway.acme.example', imageTag: 'abc123' } });
    const env = { account: '123456789012', region: 'us-east-1' };
    const base = { env, prefix: 'ai-gov', stage: 'test' };
    const network = new NetworkStack(app, 'Net', base);
    const storage = new StorageStack(app, 'Store', base);
    const auth = new AuthStack(app, 'Auth', base);
    const registry = new RegistryStack(app, 'Registry', base);
    const stack = new ServicesStack(app, 'Services', {
      ...base, vpc: network.vpc, repositories: registry.repositories, policiesTable: storage.policiesTable, metricsTable: storage.metricsTable,
      auditLogBucket: storage.auditLogBucket, storageKey: storage.storageKey, userPool: auth.userPool, userPoolClient: auth.userPoolClient,
      apiKeysTable: storage.apiKeysTable, alertsTable: storage.alertsTable, shadowAiTable: storage.shadowAiTable,
      auditLogsTable: storage.auditLogsTable, modelsTable: storage.modelsTable, complianceTable: storage.complianceTable,
      tenantsTable: storage.tenantsTable, usersTable: storage.usersTable,
    });
    template = Template.fromStack(stack);
  });

  it('runs four services, each on the image built from this commit', () => {
    template.resourceCountIs('AWS::ECS::Service', 4);
    template.resourceCountIs('AWS::ECR::Repository', 0); // they live in the registry stack, created first
    const defs = Object.values(template.findResources('AWS::ECS::TaskDefinition')) as any[];
    for (const d of defs) expect(JSON.stringify(d.Properties.ContainerDefinitions[0].Image)).toContain(':abc123');
  });

  it('gives only the gateway the private signing key, and the internal services only the public keys', () => {
    const defs = Object.values(template.findResources('AWS::ECS::TaskDefinition')) as any[];
    const holding = (name: string) => defs.filter((d) => d.Properties.ContainerDefinitions.some((c: any) => (c.Secrets ?? []).some((x: any) => x.Name === name)))
      .map((d) => d.Properties.ContainerDefinitions[0].Name).sort();
    expect(holding('INTERNAL_SIGNING_KEY')).toEqual(['GatewayContainer']);
    expect(holding('INTERNAL_TRUSTED_KEYS')).toEqual(['AnalyticsContainer', 'DataProtectionContainer', 'PolicyEngineContainer']);
    expect(holding('INTERNAL_SERVICE_KEY')).toEqual([]);
    // No key in plain environment variables.
    expect(JSON.stringify(defs)).not.toMatch(/"Name":"INTERNAL_(SIGNING|TRUSTED)_KEYS?","Value"/);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', { SigningSecret: Match.anyValue(), TrustedSecret: Match.anyValue() });
  });

  it('has the gateway store provider keys and API credentials under the platform\'s own key', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([Match.objectLike({ Name: 'GatewayContainer', Environment: Match.arrayWith([Match.objectLike({ Name: 'PROVIDER_KEYS_KMS_KEY_ID' })]) })]),
    });
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policies).toContain('kms:GenerateDataKey');
  });

  it('puts a web firewall on the public load balancer that never blocks on prompt bodies', () => {
    template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
    const acl = Object.values(template.findResources('AWS::WAFv2::WebACL'))[0] as any;
    const rules = acl.Properties.Rules;
    expect(rules.find((r: any) => r.Name === 'RatePerAddress').Statement.RateBasedStatement.AggregateKeyType).toBe('IP');
    const common = rules.find((r: any) => r.Name === 'AWSManagedRulesCommonRuleSet').Statement.ManagedRuleGroupStatement;
    const counted = common.RuleActionOverrides.map((o: any) => o.Name);
    expect(counted).toEqual(expect.arrayContaining(['SizeRestrictions_BODY', 'CrossSiteScripting_BODY']));
    expect(common.RuleActionOverrides.every((o: any) => o.ActionToUse.Count)).toBe(true);
    expect(JSON.stringify(acl)).toContain('AWSManagedRulesAmazonIpReputationList');
  });

  it('connects services directly over mutual TLS, by private DNS name, with no internal load balancer', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    template.resourceCountIs('AWS::ServiceDiscovery::PrivateDnsNamespace', 1);
    template.resourceCountIs('AWS::ServiceDiscovery::Service', 3);
    const defs = Object.values(template.findResources('AWS::ECS::TaskDefinition')) as any[];
    for (const d of defs) {
      const names = (d.Properties.ContainerDefinitions[0].Secrets ?? []).map((x: any) => x.Name);
      expect(names).toEqual(expect.arrayContaining(['INTERNAL_TLS_CA', 'INTERNAL_TLS_CERT', 'INTERNAL_TLS_KEY']));
    }
    const gw = defs.find((d) => d.Properties.ContainerDefinitions[0].Name === 'GatewayContainer');
    const env = Object.fromEntries(gw.Properties.ContainerDefinitions[0].Environment.map((e: any) => [e.Name, e.Value]));
    expect(env.POLICY_ENGINE_URL).toBe('https://policy-engine.ai-gov-test.internal:3001');
    expect(env.ANALYTICS_URL).toBe('https://analytics.ai-gov-test.internal:3003');
  });

  it('lets only the gateway reach the internal services', () => {
    const ingress = Object.values(template.findResources('AWS::EC2::SecurityGroupIngress')) as any[];
    for (const port of [3001, 3002, 3003]) {
      const rules = ingress.filter((r) => r.Properties.FromPort === port);
      expect(rules).toHaveLength(1);
      expect(rules[0].Properties.SourceSecurityGroupId).toBeDefined();
      expect(rules[0].Properties.CidrIp).toBeUndefined();
    }
    // No service accepts connections by network range; only the public load balancer faces the internet.
    const services = (Object.values(template.findResources('AWS::EC2::SecurityGroup')) as any[]).filter((g) => /service security group/.test(g.Properties.GroupDescription));
    expect(services).toHaveLength(4);
    expect(JSON.stringify(services.map((g) => g.Properties.SecurityGroupIngress ?? []))).not.toContain('CidrIp');
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
