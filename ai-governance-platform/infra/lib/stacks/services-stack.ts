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
import { Construct } from 'constructs';

interface ServicesStackProps extends cdk.StackProps {
  prefix: string;
  stage: string;
  vpc: ec2.Vpc;
  policiesTable: dynamodb.Table;
  metricsTable: dynamodb.Table;
  auditLogBucket: s3.Bucket;
  userPool: cognito.UserPool;
}

export class ServicesStack extends cdk.Stack {
  public readonly gatewayService: ecs.FargateService;
  public readonly cluster: ecs.Cluster;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ServicesStackProps) {
    super(scope, id, props);

    const { prefix, stage, vpc, policiesTable, metricsTable, auditLogBucket } = props;

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
      environment: commonEnv,
    });
    policiesTable.grantReadData(policyEngineService.taskDefinition.taskRole);

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

    // --- Analytics Service ---
    const analyticsService = this.createService({
      id: 'Analytics',
      name: 'analytics',
      prefix,
      stage,
      cluster: this.cluster,
      vpc,
      port: 3003,
      cpu: 512,
      memory: 1024,
      environment: {
        ...commonEnv,
        ATHENA_DATABASE: `${prefix}_logs_${stage}`,
        ATHENA_OUTPUT_BUCKET: `s3://${auditLogBucket.bucketName}/athena-results/`,
      },
    });
    metricsTable.grantReadData(analyticsService.taskDefinition.taskRole);
    auditLogBucket.grantRead(analyticsService.taskDefinition.taskRole);

    // --- Gateway Service (public-facing) ---
    this.gatewayService = this.createService({
      id: 'Gateway',
      name: 'gateway',
      prefix,
      stage,
      cluster: this.cluster,
      vpc,
      port: 3000,
      cpu: 1024,
      memory: 2048,
      environment: {
        ...commonEnv,
        POLICY_ENGINE_URL: `http://${internalAlb.loadBalancerDnsName}:3001`,
        DATA_PROTECTION_URL: `http://${internalAlb.loadBalancerDnsName}:3002`,
      },
    });

    // Grant gateway permissions
    auditLogBucket.grantWrite(this.gatewayService.taskDefinition.taskRole);
    this.gatewayService.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      })
    );

    // Public ALB listener → Gateway
    const listener = this.loadBalancer.addListener('HttpsListener', {
      port: 443,
      open: true,
      // In production: add ACM certificate here
      // certificates: [acm.Certificate.fromCertificateArn(...)],
      defaultAction: elbv2.ListenerAction.fixedResponse(200, {
        contentType: 'application/json',
        messageBody: '{"status":"ok"}',
      }),
    });

    listener.addTargets('GatewayTarget', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.gatewayService],
      healthCheck: { path: '/health', interval: cdk.Duration.seconds(30) },
    });

    // HTTP → HTTPS redirect
    this.loadBalancer.addListener('HttpRedirect', {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443' }),
    });

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
  }): ecs.FargateService {
    const { id, name, prefix, stage, cluster, vpc, port, cpu, memory, environment } = config;

    const repo = new ecr.Repository(this, `${id}Repo`, {
      repositoryName: `${prefix}-${name}-${stage}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    const logGroup = new logs.LogGroup(this, `${id}Logs`, {
      logGroupName: `/ecs/${prefix}-${name}-${stage}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const taskDef = new ecs.FargateTaskDefinition(this, `${id}TaskDef`, {
      cpu,
      memoryLimitMiB: memory,
    });

    taskDef.addContainer(`${id}Container`, {
      image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
      portMappings: [{ containerPort: port }],
      environment,
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
      desiredCount: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [sg],
      enableExecuteCommand: true, // For debugging
      circuitBreaker: { rollback: true },
    });
  }
}
