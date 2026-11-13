import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';
import type { ServiceName } from './registry-stack';
import { GatewayFirewall } from '../constructs/gateway-firewall';
import { InternalKeys } from '../constructs/internal-keys';

interface ServicesStackProps extends cdk.StackProps {
  prefix: string;
  stage: string;
  vpc: ec2.Vpc;
  policiesTable: dynamodb.Table;
  metricsTable: dynamodb.Table;
  auditLogBucket: s3.Bucket;
  /** Encrypts the provider keys and API credentials the gateway stores in Secrets Manager. */
  storageKey?: kms.IKey;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  apiKeysTable: dynamodb.Table;
  alertsTable: dynamodb.Table;
  shadowAiTable: dynamodb.Table;
  /** Image repositories (RegistryStack). */
  repositories: Record<ServiceName, ecr.IRepository>;
  mcpTables?: {
    servers: dynamodb.Table; apis: dynamodb.Table; tools: dynamodb.Table;
    versions: dynamodb.Table; approvals: dynamodb.Table; oauth: dynamodb.Table; connectors: dynamodb.Table;
  };
  /** Admin activity and log export (gateway only). */
  logTables?: { activity: dynamodb.Table; logExport: dynamodb.Table; enforcement?: dynamodb.Table; catalog?: dynamodb.Table };
  /** The gateway's outbound addresses (the NAT gateways), for the Enforcement page's "allow only the gateway" rules. */
  egressAddresses?: string[];
  auditLogsTable: dynamodb.Table;
  modelsTable: dynamodb.Table;
  complianceTable: dynamodb.Table;
  tenantsTable: dynamodb.Table;
  usersTable: dynamodb.Table;
}

export class ServicesStack extends cdk.Stack {
  public readonly gatewayService: ecs.FargateService;
  public readonly cluster: ecs.Cluster;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  /** CloudFront sends this to the gateway so it knows a request came through our own edge (see client-address.ts). */
  public readonly edgeSecret: secretsmanager.Secret;
  private readonly repositories: Record<ServiceName, ecr.IRepository>;
  private readonly imageTag: string;

  constructor(scope: Construct, id: string, props: ServicesStackProps) {
    super(scope, id, props);
    this.repositories = props.repositories;
    this.imageTag = this.node.tryGetContext('imageTag') || 'latest';

    const { prefix, stage, vpc, policiesTable, metricsTable, auditLogBucket } = props;
    const { apiKeysTable, alertsTable, shadowAiTable, auditLogsTable, modelsTable, complianceTable, tenantsTable, usersTable } = props;

    // ECS Cluster
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${prefix}-cluster-${stage}`,
      vpc,
      containerInsights: true,
    });

    // Services find each other by private DNS name (<service>.<prefix>-<stage>.internal) and connect directly,
    // over mutual TLS: a load balancer in between couldn't carry the caller's certificate.
    const internalDomain = `${prefix}-${stage}.internal`;
    this.cluster.addDefaultCloudMapNamespace({ name: internalDomain, vpc });
    const internalUrl = (name: string, port: number) => `https://${name}.${internalDomain}:${port}`;
    // Each service's certificate, made by scripts/internal-pki.mjs (run before deploying).
    const tlsSecrets = (name: string) => {
      const secret = secretsmanager.Secret.fromSecretNameV2(this, `${name}Tls`, `${prefix}/${stage}/internal-tls/${name}/tls`);
      return {
        INTERNAL_TLS_CA: ecs.Secret.fromSecretsManager(secret, 'ca'),
        INTERNAL_TLS_CERT: ecs.Secret.fromSecretsManager(secret, 'cert'),
        INTERNAL_TLS_KEY: ecs.Secret.fromSecretsManager(secret, 'key'),
      };
    };

    // Public ALB for gateway
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'PublicAlb', {
      loadBalancerName: `${prefix}-alb-${stage}`,
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // The dashboard and website reach the gateway through CloudFront, which adds this secret to each request.
    // The gateway then believes CloudFront's X-Forwarded-For entry (the person's address); without it, only the
    // load balancer's (TRUSTED_PROXY_HOPS=1). To change it: set a new value in Secrets Manager and deploy both
    // the services and frontend stacks; until the gateway restarts, browsers are limited per CloudFront location.
    this.edgeSecret = new secretsmanager.Secret(this, 'EdgeSecret', {
      secretName: `${prefix}/${stage}/edge-secret`,
      description: 'Sent by CloudFront to the gateway to show a request came through Probaline\'s own edge.',
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Web firewall on the public load balancer (-c waf=false turns it off, e.g. for a throwaway stage).
    if (this.node.tryGetContext('waf') !== 'false') {
      const rate = Number(this.node.tryGetContext('wafRatePerFiveMinutes')) || undefined;
      new GatewayFirewall(this, 'Firewall', { prefix, stage, loadBalancer: this.loadBalancer, ratePerFiveMinutes: rate, edgeSecret: this.edgeSecret });
    }

    // Shared environment variables
    const commonEnv = {
      AWS_REGION: this.region,
      STAGE: stage,
      POLICIES_TABLE: policiesTable.tableName,
      METRICS_TABLE: metricsTable.tableName,
      AUDIT_LOG_BUCKET: auditLogBucket.bucketName,
      COMPREHEND_ENABLED: 'true',
    };

    // Internal calls: only the gateway holds the private signing key; the internal services hold the public keys.
    const internalKeys = new InternalKeys(this, 'InternalKeys', { prefix, stage, removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY });
    const trustedKeysSecret = { INTERNAL_TRUSTED_KEYS: ecs.Secret.fromSecretsManager(internalKeys.trustedKeys) };
    const signingKeySecret = { INTERNAL_SIGNING_KEY: ecs.Secret.fromSecretsManager(internalKeys.signingKey) };

    // One image (repository "probaline") runs everything. PROBALINE_ROLE splits it here: the gateway, with every
    // check inside it, on the prompt path, and reports on their own, so a heavy report never slows a prompt.
    // Customer installs run the same image in the "all" role instead.

    // --- Analytics Service: every report built from history. Reads only; never on the request path. ---
    const analyticsService = this.createService({
      id: 'Analytics',
      name: 'analytics',
      role: 'reports',
      internal: true,
      prefix,
      stage,
      cluster: this.cluster,
      vpc,
      port: 3003,
      cpu: 1024,
      memory: 2048,
      environment: {
        ...commonEnv,
        AUDIT_LOGS_TABLE: auditLogsTable.tableName,
        TENANTS_TABLE: tenantsTable.tableName,
        SHADOW_AI_TABLE: shadowAiTable.tableName,
      },
      secrets: { ...trustedKeysSecret, ...tlsSecrets('analytics') },
    });
    for (const t of [auditLogsTable, tenantsTable, shadowAiTable, metricsTable]) t.grantReadData(analyticsService.taskDefinition.taskRole);


    // Customers' provider API keys live in Secrets Manager under this prefix.
    const providerKeysPrefix = `${prefix}/${stage}/provider-keys`;
    // The gateway's public address (-c gatewayUrl=https://gateway.example.com): MCP sign-in and the identity
    // statements sent to company APIs name it, so it must not depend on request headers.
    const gatewayUrl: string | undefined = this.node.tryGetContext('gatewayUrl');
    // Email through SES (-c emailFrom="Probaline <no-reply@probaline.com>", an address or domain verified in SES):
    // website enquiries go to -c contactEmail=sales@…, and alerts to the addresses each company sets.
    const emailFrom: string | undefined = this.node.tryGetContext('emailFrom');
    const contactEmail: string | undefined = this.node.tryGetContext('contactEmail');
    // Alerts link to the dashboard when its custom name is known (-c dashboardDomain=app.example.com).
    const dashboardDomain: string | undefined = this.node.tryGetContext('dashboardDomain');

    // Prompt attacks (check 4, Beta): a guardrail with only Bedrock's prompt-attack filter. The gateway calls it
    // with ApplyGuardrail on the new message only, after secrets and personal data are removed, and only for
    // companies that turned the check on. Leave it out with -c promptAttackGuardrail=false (phrases only).
    const attackGuardrail = this.node.tryGetContext('promptAttackGuardrail') === 'false' ? undefined : new bedrock.CfnGuardrail(this, 'PromptAttackGuardrail', {
      name: `${prefix}-prompt-attacks-${stage}`,
      description: 'Probaline check 4: prompt-attack filter only',
      contentPolicyConfig: { filtersConfig: [{ type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' }] },
      blockedInputMessaging: 'Blocked by Probaline: possible prompt attack.',
      blockedOutputsMessaging: 'Blocked by Probaline.',
    });

    // License files for customer-run installs are signed with this key; its private half never leaves KMS.
    // Customer gateways check them against the public half, compiled into the image
    // (services/gateway/src/licensing/trusted-keys.ts). Kept on delete: licenses it signed stay in use.
    const licenseSigningKey = new kms.Key(this, 'LicenseSigningKey', {
      description: `Probaline ${stage}: signs license files for customer-run installs`,
      keySpec: kms.KeySpec.ECC_NIST_P256,
      keyUsage: kms.KeyUsage.SIGN_VERIFY,
      alias: `alias/${prefix}-license-signing-${stage}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // Signs the AI service catalog every install downloads: the Cloud gateway publishes it (Catalog page) and serves it
    // at /public/catalog/v1/latest.json. Installs check it against the public half compiled into the image
    // (services/gateway/src/catalog/trusted-keys.ts). Kept on delete so catalogs it signed stay valid.
    const catalogSigningKey = new kms.Key(this, 'CatalogSigningKey', {
      description: `Probaline ${stage}: signs the AI service catalog installs download`,
      keySpec: kms.KeySpec.ECC_NIST_P256,
      keyUsage: kms.KeyUsage.SIGN_VERIFY,
      alias: `alias/${prefix}-catalog-signing-${stage}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    new cdk.CfnOutput(this, 'CatalogSigningKeyArn', { value: catalogSigningKey.keyArn });

    // --- Gateway Service (public-facing) ---
    this.gatewayService = this.createService({
      id: 'Gateway',
      name: 'gateway',
      role: 'gateway',
      secrets: { ...signingKeySecret, ...tlsSecrets('gateway'), EDGE_SECRET: ecs.Secret.fromSecretsManager(this.edgeSecret) },
      prefix,
      stage,
      cluster: this.cluster,
      vpc,
      port: 3000,
      cpu: 1024,
      memory: 2048,
      environment: {
        ...commonEnv,
        TENANTS_TABLE: tenantsTable.tableName,
        USERS_TABLE: usersTable.tableName,
        MODELS_TABLE: modelsTable.tableName,
        COMPLIANCE_TABLE: complianceTable.tableName,
        API_KEYS_TABLE: apiKeysTable.tableName,
        ALERTS_TABLE: alertsTable.tableName,
        SHADOW_AI_TABLE: shadowAiTable.tableName,
        ...(props.mcpTables ? {
          MCP_SERVERS_TABLE: props.mcpTables.servers.tableName,
          MCP_APIS_TABLE: props.mcpTables.apis.tableName,
          MCP_TOOLS_TABLE: props.mcpTables.tools.tableName,
          MCP_VERSIONS_TABLE: props.mcpTables.versions.tableName,
          MCP_APPROVALS_TABLE: props.mcpTables.approvals.tableName,
          MCP_OAUTH_TABLE: props.mcpTables.oauth.tableName,
          MCP_CONNECTORS_TABLE: props.mcpTables.connectors.tableName,
        } : {}),
        ...(emailFrom ? { EMAIL_FROM: emailFrom } : {}),
        LICENSE_SIGNING_KMS_KEY_ID: licenseSigningKey.keyArn,
        // The working draft: it always has the filter as defined above.
        ...(attackGuardrail ? { PROMPT_ATTACK_GUARDRAIL_ID: attackGuardrail.attrGuardrailId, PROMPT_ATTACK_GUARDRAIL_VERSION: 'DRAFT' } : {}),
        ...(contactEmail ? { CONTACT_EMAIL_TO: contactEmail } : {}),
        ...(dashboardDomain ? { DASHBOARD_URL: `https://${dashboardDomain}` } : {}),
        ...(props.logTables ? { ACTIVITY_TABLE: props.logTables.activity.tableName, LOG_EXPORT_TABLE: props.logTables.logExport.tableName } : {}),
        ...(props.logTables?.enforcement ? { ENFORCEMENT_TABLE: props.logTables.enforcement.tableName } : {}),
        // Cloud publishes the AI service catalog and looks for new AI services (Claude on Amazon Bedrock classifies them).
        ...(props.logTables?.catalog ? {
          CATALOG_TABLE: props.logTables.catalog.tableName,
          CATALOG_PUBLISHER: 'on',
          CATALOG_DISCOVERY: this.node.tryGetContext('catalogDiscovery') === 'false' ? 'off' : 'on',
          CATALOG_SIGNING_KMS_KEY_ID: catalogSigningKey.keyId,
          ...(this.node.tryGetContext('catalogClassifierModel') ? { CATALOG_CLASSIFIER_MODEL: this.node.tryGetContext('catalogClassifierModel') } : {}),
        } : {}),
        ...(props.egressAddresses?.length ? { GATEWAY_EGRESS_IPS: cdk.Fn.join(',', props.egressAddresses) } : {}),
        AUDIT_LOGS_TABLE: auditLogsTable.tableName,
        ANALYTICS_URL: internalUrl('analytics', 3003),
        ALLOWED_ORIGINS: '', // None needed: browsers reach the gateway through CloudFront on the site's own address
        // Without a public address (dev stages), the load balancer's own: identity tokens and MCP sign-in name it.
        PUBLIC_GATEWAY_URL: gatewayUrl ?? `http://${this.loadBalancer.loadBalancerDnsName}`,
        COGNITO_USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
        PROVIDER_KEYS_SECRET_PREFIX: providerKeysPrefix,
        // Operational metrics for the CloudWatch alarms (same namespace the observability stack watches).
        METRICS_NAMESPACE: `${prefix}/${stage}`,
        ...(props.storageKey ? { PROVIDER_KEYS_KMS_KEY_ID: props.storageKey.keyArn } : {}),
        GOVERNANCE_FAIL_MODE: 'closed',
        // One proxy in front: the load balancer. Its X-Forwarded-For entry is the caller's real address.
        TRUSTED_PROXY_HOPS: '1',
      },
    });

    // Services start only once their keys exist.
    for (const svc of [analyticsService, this.gatewayService]) svc.node.addDependency(internalKeys.ready);

    // Reports accept connections only from the gateway, nothing else in the network.
    analyticsService.connections.allowFrom(this.gatewayService, ec2.Port.tcp(3003), 'analytics from the gateway only');

    // Grant gateway permissions. The rules, compliance and personal-data checks run inside it.
    policiesTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    complianceTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    this.gatewayService.taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['comprehend:DetectPiiEntities'], resources: ['*'] }));
    this.gatewayService.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:CreateSecret',
          'secretsmanager:PutSecretValue',
          'secretsmanager:GetSecretValue',
          'secretsmanager:DeleteSecret',
          'secretsmanager:TagResource',
        ],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:${providerKeysPrefix}/*`],
      })
    );
    // Writes archive copies, and lists and deletes days past each company's retention period.
    auditLogBucket.grantReadWrite(this.gatewayService.taskDefinition.taskRole);
    auditLogBucket.grantDelete(this.gatewayService.taskDefinition.taskRole);
    // Secrets Manager encrypts and decrypts those secrets with the platform's key on the gateway's behalf.
    props.storageKey?.grantEncryptDecrypt(this.gatewayService.taskDefinition.taskRole);
    usersTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    // Inviting, re-roling, disabling and removing people's sign-in accounts.
    props.userPool.grant(this.gatewayService.taskDefinition.taskRole,
      'cognito-idp:AdminCreateUser', 'cognito-idp:AdminUpdateUserAttributes', 'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminEnableUser', 'cognito-idp:AdminDeleteUser', 'cognito-idp:AdminGetUser');
    tenantsTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    modelsTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    apiKeysTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    alertsTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    shadowAiTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    for (const t of Object.values(props.mcpTables ?? {})) t.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    for (const t of Object.values(props.logTables ?? {})) t?.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    // The Enforcement page writes lock policies that allow only this role (e.g. on Bedrock).
    this.gatewayService.taskDefinition.defaultContainer?.addEnvironment('GATEWAY_ROLE_ARN', this.gatewayService.taskDefinition.taskRole.roleArn);
    auditLogsTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    // Shared counters: per-key and MCP rate limits, alert windows, spend, and the daily key-rotation lock.
    metricsTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    if (emailFrom) {
      // Send only from this account's verified identities.
      this.gatewayService.taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`, `arn:aws:ses:${this.region}:${this.account}:configuration-set/*`],
      }));
    }
    this.gatewayService.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      })
    );
    // The Cloud gateway signs the AI service catalog it publishes, and asks Claude on Amazon Bedrock about candidates.
    this.gatewayService.taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['kms:Sign', 'kms:GetPublicKey'],
      resources: [catalogSigningKey.keyArn],
    }));
    this.gatewayService.taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['bedrock-mantle:CreateInference'],
      resources: ['*'],
    }));
    // Only the gateway may sign license files (platform admins issue them from the Licenses page).
    this.gatewayService.taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['kms:Sign', 'kms:GetPublicKey'],
      resources: [licenseSigningKey.keyArn],
    }));
    new cdk.CfnOutput(this, 'LicenseSigningKeyArn', { value: licenseSigningKey.keyArn });
    if (attackGuardrail) {
      this.gatewayService.taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ['bedrock:ApplyGuardrail'],
        resources: [attackGuardrail.attrGuardrailArn],
      }));
    }

    // Public ALB listener → Gateway. HTTPS needs a certificate ARN (-c certificateArn=...); without one,
    // non-production stages serve plain HTTP so they can still be deployed and tested.
    const certificateArn: string | undefined = this.node.tryGetContext('certificateArn');
    if (!certificateArn && stage === 'prod') {
      throw new Error('Production needs a TLS certificate: deploy with -c certificateArn=arn:aws:acm:...');
    }
    let gatewayTargetGroup: elbv2.ApplicationTargetGroup;
    const gatewayTarget = {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.gatewayService],
      healthCheck: { path: '/health', interval: cdk.Duration.seconds(30) },
    };
    if (certificateArn) {
      const listener = this.loadBalancer.addListener('HttpsListener', {
        port: 443,
        open: true,
        certificates: [elbv2.ListenerCertificate.fromArn(certificateArn)],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      });
      gatewayTargetGroup = listener.addTargets('GatewayTarget', gatewayTarget);
      this.loadBalancer.addListener('HttpRedirect', {
        port: 80,
        defaultAction: elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }),
      });
    } else {
      const listener = this.loadBalancer.addListener('HttpListener', { port: 80, open: true });
      gatewayTargetGroup = listener.addTargets('GatewayTarget', gatewayTarget);
    }

    // Every service scales with load. Production keeps at least two copies of each, in different zones.
    const prod = stage === 'prod';
    for (const [id, svc, max] of [
      ['Gateway', this.gatewayService, prod ? 20 : 3],
      ['Analytics', analyticsService, prod ? 4 : 2],
    ] as const) {
      const scaling = svc.autoScaleTaskCount({ minCapacity: prod ? 2 : 1, maxCapacity: max });
      scaling.scaleOnCpuUtilization(`${id}Cpu`, { targetUtilizationPercent: 60, scaleOutCooldown: cdk.Duration.seconds(60), scaleInCooldown: cdk.Duration.seconds(300) });
      scaling.scaleOnMemoryUtilization(`${id}Memory`, { targetUtilizationPercent: 75 });
      // The gateway also scales on traffic: AI answers mostly wait on the provider, so CPU rises late.
      // context gatewayRequestsPerTarget is requests a minute per copy (default 6000, about 100 a second).
      if (id === 'Gateway') {
        scaling.scaleOnRequestCount('GatewayRequests', {
          targetGroup: gatewayTargetGroup!,
          requestsPerTarget: Number(this.node.tryGetContext('gatewayRequestsPerTarget')) || 6000,
          scaleOutCooldown: cdk.Duration.seconds(60),
          scaleInCooldown: cdk.Duration.seconds(300),
        });
      }
    }

    new cdk.CfnOutput(this, 'LoadBalancerDns', { value: this.loadBalancer.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
  }

  private createService(config: {
    id: string;
    name: string;
    prefix: string;
    stage: string;
    cluster: ecs.Cluster;
    vpc: ec2.Vpc;
    port: number;
    cpu: number;
    memory: number;
    environment: Record<string, string>;
    secrets?: Record<string, ecs.Secret>;
    /** Internal services: reachable by private DNS name, over TLS. */
    internal?: boolean;
    /** What this service runs of the one Probaline image (PROBALINE_ROLE). */
    role: 'gateway' | 'reports';
  }): ecs.FargateService {
    const { id, name, prefix, stage, cluster, vpc, port, cpu, memory, secrets, internal, role } = config;
    const environment = { ...config.environment, PROBALINE_ROLE: role, PORT: String(port) };

    const repo = this.repositories.probaline;
    const logGroup = new logs.LogGroup(this, `${id}Logs`, {
      logGroupName: `/ecs/${prefix}-${name}-${stage}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    const taskDef = new ecs.FargateTaskDefinition(this, `${id}TaskDef`, {
      cpu,
      memoryLimitMiB: memory,
    });

    taskDef.addContainer(`${id}Container`, {
      // The image built from this commit (-c imageTag=<sha>): a new tag means a new task definition, so it rolls out.
      image: ecs.ContainerImage.fromEcrRepository(repo, this.imageTag),
      portMappings: [{ containerPort: port }],
      environment,
      ...(secrets ? { secrets } : {}),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: name,
        logGroup,
      }),
      healthCheck: {
        // Node itself checks /health (distroless images carry no shell or curl; Node is at /nodejs/bin). Internal services serve TLS; /health
        // needs no certificate, and this check talks only to itself.
        command: ['CMD', '/nodejs/bin/node', '-e', `require('${internal ? 'https' : 'http'}').get({host:'localhost',port:${port},path:'/health',rejectUnauthorized:false},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))`],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
      },
    });

    const sg = new ec2.SecurityGroup(this, `${id}Sg`, {
      vpc,
      description: `${name} service security group`,
      allowAllOutbound: true,
    });
    // No open ingress: the gateway is reached through its load balancer, internal services only from the gateway.

    return new ecs.FargateService(this, `${id}Service`, {
      serviceName: `${prefix}-${name}-${stage}`,
      cluster,
      taskDefinition: taskDef,
      desiredCount: stage === 'prod' ? 2 : 1,
      // Deploys start new copies before stopping old ones, so capacity never drops.
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [sg],
      // The images have no shell, so ECS Exec has nothing to run; keep the way in closed.
      enableExecuteCommand: false,
      circuitBreaker: { rollback: true },
      ...(internal ? { cloudMapOptions: { name } } : {}),
    });
  }
}
