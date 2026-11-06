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
import { Construct } from 'constructs';

interface ServicesStackProps extends cdk.StackProps {
  prefix: string;
  stage: string;
  vpc: ec2.Vpc;
  policiesTable: dynamodb.Table;
  metricsTable: dynamodb.Table;
  auditLogBucket: s3.Bucket;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  apiKeysTable: dynamodb.Table;
  alertsTable: dynamodb.Table;
  shadowAiTable: dynamodb.Table;
  mcpTables?: {
    servers: dynamodb.Table; apis: dynamodb.Table; tools: dynamodb.Table;
    versions: dynamodb.Table; approvals: dynamodb.Table; oauth: dynamodb.Table; connectors: dynamodb.Table;
  };
  auditLogsTable: dynamodb.Table;
  modelsTable: dynamodb.Table;
  complianceTable: dynamodb.Table;
  tenantsTable: dynamodb.Table;
}

export class ServicesStack extends cdk.Stack {
  public readonly gatewayService: ecs.FargateService;
  public readonly cluster: ecs.Cluster;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ServicesStackProps) {
    super(scope, id, props);

    const { prefix, stage, vpc, policiesTable, metricsTable, auditLogBucket } = props;
    const { apiKeysTable, alertsTable, shadowAiTable, auditLogsTable, modelsTable, complianceTable, tenantsTable } = props;

    // ECS Cluster
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${prefix}-cluster-${stage}`,
      vpc,
      containerInsights: true,
    });

    // Internal ALB for service-to-service communication
    const internalAlb = new elbv2.ApplicationLoadBalancer(this, 'InternalAlb', {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Public ALB for gateway
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'PublicAlb', {
      loadBalancerName: `${prefix}-alb-${stage}`,
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // Shared environment variables
    const commonEnv = {
      AWS_REGION: this.region,
      STAGE: stage,
      POLICIES_TABLE: policiesTable.tableName,
      METRICS_TABLE: metricsTable.tableName,
      AUDIT_LOG_BUCKET: auditLogBucket.bucketName,
      COMPREHEND_ENABLED: 'true',
    };

    // --- Policy Engine Service ---
    const policyEngineService = this.createService({
      id: 'PolicyEngine',
      name: 'policy-engine',
      prefix,
      stage,
      cluster: this.cluster,
      vpc,
      port: 3001,
      cpu: 512,
      memory: 1024,
      // Rules check approved models and company settings, and count requests for rate limits.
      environment: { ...commonEnv, TENANTS_TABLE: tenantsTable.tableName, MODELS_TABLE: modelsTable.tableName, COMPLIANCE_TABLE: complianceTable.tableName },
    });
    policiesTable.grantReadWriteData(policyEngineService.taskDefinition.taskRole);
    for (const t of [tenantsTable, modelsTable]) t.grantReadData(policyEngineService.taskDefinition.taskRole);
    for (const t of [metricsTable, complianceTable]) t.grantReadWriteData(policyEngineService.taskDefinition.taskRole);

    // --- Data Protection Service ---
    const dataProtectionService = this.createService({
      id: 'DataProtection',
      name: 'data-protection',
      prefix,
      stage,
      cluster: this.cluster,
      vpc,
      port: 3002,
      cpu: 512,
      memory: 1024,
      environment: commonEnv,
    });
    dataProtectionService.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['comprehend:DetectPiiEntities'],
        resources: ['*'],
      })
    );

    // The key the gateway signs internal requests with, and analytics checks them with. Generated here, held
    // in Secrets Manager, and given only to those two services.
    const internalKey = new secretsmanager.Secret(this, 'InternalServiceKey', {
      secretName: `${prefix}/${stage}/internal-service-key`,
      description: 'Signs requests from the gateway to internal services',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
    const internalKeySecret = { INTERNAL_SERVICE_KEY: ecs.Secret.fromSecretsManager(internalKey) };

    // --- Analytics Service: every report built from history. Reads only; never on the request path. ---
    const analyticsService = this.createService({
      id: 'Analytics',
      name: 'analytics',
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
      secrets: internalKeySecret,
    });
    for (const t of [auditLogsTable, tenantsTable, shadowAiTable, metricsTable]) t.grantReadData(analyticsService.taskDefinition.taskRole);

    // The gateway reaches the policy engine and data protection through the internal load balancer: one
    // listener per service, open only inside the VPC.
    const internalRoute = (id: string, service: ecs.FargateService, port: number) => {
      const listener = internalAlb.addListener(`${id}InternalListener`, { port, protocol: elbv2.ApplicationProtocol.HTTP, open: false });
      internalAlb.connections.allowFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(port), `${id} from inside the VPC`);
      listener.addTargets(`${id}InternalTarget`, {
        port, protocol: elbv2.ApplicationProtocol.HTTP, targets: [service],
        healthCheck: { path: '/health', interval: cdk.Duration.seconds(30), healthyThresholdCount: 2 },
        deregistrationDelay: cdk.Duration.seconds(30),
      });
    };
    internalRoute('PolicyEngine', policyEngineService, 3001);
    internalRoute('DataProtection', dataProtectionService, 3002);
    internalRoute('Analytics', analyticsService, 3003);

    // Customers' provider API keys live in Secrets Manager under this prefix.
    const providerKeysPrefix = `${prefix}/${stage}/provider-keys`;
    // The gateway's public address (-c gatewayUrl=https://gateway.example.com): MCP sign-in and the identity
    // statements sent to company APIs name it, so it must not depend on request headers.
    const gatewayUrl: string | undefined = this.node.tryGetContext('gatewayUrl');

    // --- Gateway Service (public-facing) ---
    this.gatewayService = this.createService({
      id: 'Gateway',
      name: 'gateway',
      secrets: internalKeySecret,
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
        AUDIT_LOGS_TABLE: auditLogsTable.tableName,
        POLICY_ENGINE_URL: `http://${internalAlb.loadBalancerDnsName}:3001`,
        DATA_PROTECTION_URL: `http://${internalAlb.loadBalancerDnsName}:3002`,
        ANALYTICS_URL: `http://${internalAlb.loadBalancerDnsName}:3003`,
        ALLOWED_ORIGINS: '', // Set per environment
        ...(gatewayUrl ? { PUBLIC_GATEWAY_URL: gatewayUrl } : {}),
        COGNITO_USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
        PROVIDER_KEYS_SECRET_PREFIX: providerKeysPrefix,
        GOVERNANCE_FAIL_MODE: 'closed',
      },
    });

    // Grant gateway permissions
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
    auditLogBucket.grantWrite(this.gatewayService.taskDefinition.taskRole);
    tenantsTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    modelsTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    apiKeysTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    alertsTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    shadowAiTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    for (const t of Object.values(props.mcpTables ?? {})) t.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    auditLogsTable.grantReadWriteData(this.gatewayService.taskDefinition.taskRole);
    this.gatewayService.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      })
    );

    // Public ALB listener → Gateway. HTTPS needs a certificate ARN (-c certificateArn=...); without one,
    // non-production stages serve plain HTTP so they can still be deployed and tested.
    const certificateArn: string | undefined = this.node.tryGetContext('certificateArn');
    if (!certificateArn && stage === 'prod') {
      throw new Error('Production needs a TLS certificate: deploy with -c certificateArn=arn:aws:acm:...');
    }
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
      listener.addTargets('GatewayTarget', gatewayTarget);
      this.loadBalancer.addListener('HttpRedirect', {
        port: 80,
        defaultAction: elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }),
      });
    } else {
      const listener = this.loadBalancer.addListener('HttpListener', { port: 80, open: true });
      listener.addTargets('GatewayTarget', gatewayTarget);
    }

    // Production runs at least two gateways and scales with load.
    if (stage === 'prod') {
      const scaling = this.gatewayService.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 10 });
      scaling.scaleOnCpuUtilization('GatewayCpu', { targetUtilizationPercent: 60 });
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
  }): ecs.FargateService {
    const { id, name, prefix, stage, cluster, vpc, port, cpu, memory, environment, secrets } = config;

    const repo = new ecr.Repository(this, `${id}Repo`, {
      repositoryName: `${prefix}-${name}-${stage}`,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: stage !== 'prod',
    });

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
      image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
      portMappings: [{ containerPort: port }],
      environment,
      ...(secrets ? { secrets } : {}),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: name,
        logGroup,
      }),
      healthCheck: {
        command: ['CMD-SHELL', `curl -f http://localhost:${port}/health || exit 1`],
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
    sg.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(port));

    return new ecs.FargateService(this, `${id}Service`, {
      serviceName: `${prefix}-${name}-${stage}`,
      cluster,
      taskDefinition: taskDef,
      desiredCount: stage === 'prod' ? 2 : 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [sg],
      enableExecuteCommand: true, // For debugging
      circuitBreaker: { rollback: true },
    });
  }
}
