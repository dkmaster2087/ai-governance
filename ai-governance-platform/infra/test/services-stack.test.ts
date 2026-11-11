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
    const app = new cdk.App({ context: { gatewayUrl: 'https://gateway.acme.example', imageTag: 'abc123', emailFrom: 'no-reply@probaline.example', contactEmail: 'sales@probaline.example' } });
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
      logTables: { activity: storage.activityTable, logExport: storage.logExportTable, enforcement: storage.enforcementTable },
      egressAddresses: network.natAddresses,
    });
    template = Template.fromStack(stack);
  });

  it('gives the gateway what the Enforcement page needs: its table, outbound addresses and role', () => {
    const defs = Object.values(template.findResources('AWS::ECS::TaskDefinition')) as any[];
    const gw = defs.map((d) => d.Properties.ContainerDefinitions[0]).find((c: any) => c.Name === 'GatewayContainer');
    const names = gw.Environment.map((e: any) => e.Name);
    expect(names).toEqual(expect.arrayContaining(['ENFORCEMENT_TABLE', 'GATEWAY_EGRESS_IPS', 'GATEWAY_ROLE_ARN']));
    expect(JSON.stringify(gw.Environment.find((e: any) => e.Name === 'GATEWAY_EGRESS_IPS').Value)).toContain('EIP');
  });

  it('names TLS secrets so Secrets Manager never mistakes the end of the name for its random suffix', () => {
    // ECS fetches secrets CDK knows only by name; a name ending in "-" and six characters ("policy-engine")
    // is read as name "policy" plus a suffix, and the fetch is refused.
    const defs = Object.values(template.findResources('AWS::ECS::TaskDefinition')) as any[];
    const refs = JSON.stringify(defs.map((d) => d.Properties.ContainerDefinitions[0].Secrets));
    for (const name of ['policy-engine', 'data-protection', 'analytics', 'gateway']) expect(refs).toContain(`internal-tls/${name}/tls`);
    expect(refs).not.toMatch(/internal-tls\/[a-z-]*-[A-Za-z0-9]{6}:/);
  });

  it('lets the gateway write the shared counters (rate limits, alerts, key rotation) in the metrics table', () => {
    // CDK moves overflow statements into managed policies once the role's inline policy is full.
    const policies = [...Object.values(template.findResources('AWS::IAM::Policy')), ...Object.values(template.findResources('AWS::IAM::ManagedPolicy'))] as any[];
    const gateway = policies.filter((p) => JSON.stringify(p.Properties.Roles).includes('GatewayTaskDefTaskRole'));
    const statements = gateway.flatMap((p) => p.Properties.PolicyDocument.Statement);
    const onMetrics = statements.filter((s: any) => JSON.stringify(s.Resource).includes('MetricsTable'));
    expect(JSON.stringify(onMetrics.map((s: any) => s.Action))).toContain('dynamodb:UpdateItem');
  });

  it('gives the gateway a public address even without -c gatewayUrl (the load balancer), never localhost', () => {
    const defs = Object.values(template.findResources('AWS::ECS::TaskDefinition')) as any[];
    const gw = defs.map((d) => d.Properties.ContainerDefinitions[0]).find((c: any) => c.Name === 'GatewayContainer');
    const url = gw.Environment.find((e: any) => e.Name === 'PUBLIC_GATEWAY_URL');
    expect(url).toBeDefined();
    expect(JSON.stringify(url.Value)).not.toContain('localhost');
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

  it('gives the gateway the activity and log-export tables', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([Match.objectLike({ Name: 'GatewayContainer', Environment: Match.arrayWith([
        Match.objectLike({ Name: 'ACTIVITY_TABLE' }), Match.objectLike({ Name: 'LOG_EXPORT_TABLE' })]) })]),
    });
  });

  it('lets the gateway email from verified addresses, and sends enquiries to the team', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([Match.objectLike({ Name: 'GatewayContainer', Environment: Match.arrayWith([
        { Name: 'EMAIL_FROM', Value: 'no-reply@probaline.example' }, { Name: 'CONTACT_EMAIL_TO', Value: 'sales@probaline.example' }]) })]),
    });
    expect(JSON.stringify(template.findResources('AWS::IAM::Policy'))).toContain('ses:SendEmail');
  });

  it('scales every service on CPU and memory, never drops capacity during a deploy, and has no shell access', () => {
    template.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 4);
    template.resourceCountIs('AWS::ApplicationAutoScaling::ScalingPolicy', 8);
    for (const s of Object.values(template.findResources('AWS::ECS::Service')) as any[]) {
      expect(s.Properties.DeploymentConfiguration).toMatchObject({ MinimumHealthyPercent: 100, MaximumPercent: 200 });
      expect(s.Properties.EnableExecuteCommand).toBe(false);
    }
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

  it('believes only the load balancer\'s address, plus CloudFront\'s when it carries the edge secret', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([Match.objectLike({
        Name: 'GatewayContainer',
        Environment: Match.arrayWith([{ Name: 'TRUSTED_PROXY_HOPS', Value: '1' }]),
        Secrets: Match.arrayWith([Match.objectLike({ Name: 'EDGE_SECRET' })]),
      })]),
    });
    template.hasResourceProperties('AWS::SecretsManager::Secret', { Name: 'ai-gov/test/edge-secret', GenerateSecretString: Match.objectLike({ PasswordLength: 48 }) });
    // Requests from CloudFront are left out of the firewall's per-address limit; the gateway limits them per person.
    const acl = Object.values(template.findResources('AWS::WAFv2::WebACL'))[0] as any;
    const rate = acl.Properties.Rules.find((r: any) => r.Name === 'RatePerAddress').Statement.RateBasedStatement;
    const match = rate.ScopeDownStatement.NotStatement.Statement.ByteMatchStatement;
    expect(match.FieldToMatch.SingleHeader.Name).toBe('x-probaline-edge');
    expect(JSON.stringify(match.SearchString)).toContain('resolve:secretsmanager');
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
