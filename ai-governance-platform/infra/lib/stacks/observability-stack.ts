import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

interface ObservabilityStackProps extends cdk.StackProps {
  prefix: string;
  stage: string;
  auditLogBucket: s3.Bucket;
  /** The gateway's public load balancer, for the 5xx alarm. */
  loadBalancer?: elbv2.IApplicationLoadBalancer;
  /** Who is emailed when an alarm goes off. */
  alarmEmail?: string;
}

export class ObservabilityStack extends cdk.Stack {
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { prefix, stage, auditLogBucket } = props;

    // CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${prefix}-overview-${stage}`,
    });

    const services = ['gateway', 'policy-engine', 'data-protection', 'analytics'];

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `# AI Governance Platform — ${stage.toUpperCase()}`,
        width: 24,
        height: 1,
      })
    );

    // Service health widgets
    dashboard.addWidgets(
      ...services.map(
        (svc) =>
          new cloudwatch.GraphWidget({
            title: `${svc} — Request Count`,
            width: 6,
            left: [
              new cloudwatch.Metric({
                namespace: 'ECS/ContainerInsights',
                metricName: 'TaskCount',
                dimensionsMap: { ServiceName: `${prefix}-${svc}-${stage}` },
              }),
            ],
          })
      )
    );

    // Alarms go to this topic; an operator email is subscribed when given (-c alarmEmail=…).
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', { topicName: `${prefix}-alarms-${stage}`, displayName: `Probaline ${stage} alarms` });
    if (props.alarmEmail) this.alarmTopic.addSubscription(new subs.EmailSubscription(props.alarmEmail));
    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: this.alarmTopic.topicArn });

    // The gateway's own errors (5xx from its targets), on its load balancer.
    const gatewayErrorAlarm = new cloudwatch.Alarm(this, 'GatewayErrorAlarm', {
      alarmName: `${prefix}-gateway-errors-${stage}`,
      metric: props.loadBalancer
        ? props.loadBalancer.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { statistic: 'Sum', period: cdk.Duration.minutes(5) })
        : new cloudwatch.Metric({ namespace: 'AWS/ApplicationELB', metricName: 'HTTPCode_Target_5XX_Count', statistic: 'Sum', period: cdk.Duration.minutes(5) }),
      threshold: 10,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Policy violation spike alarm
    const policyViolationAlarm = new cloudwatch.Alarm(this, 'PolicyViolationAlarm', {
      alarmName: `${prefix}-policy-violations-${stage}`,
      metric: new cloudwatch.Metric({
        namespace: `${prefix}/${stage}`,
        metricName: 'PolicyViolations',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 50,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // High latency alarm
    const highLatencyAlarm = new cloudwatch.Alarm(this, 'HighLatencyAlarm', {
      alarmName: `${prefix}-high-latency-${stage}`,
      metric: new cloudwatch.Metric({
        namespace: `${prefix}/${stage}`,
        metricName: 'RequestLatency',
        statistic: 'p95',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5000, // 5 seconds p95
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Circuit breaker open alarm
    const circuitBreakerAlarm = new cloudwatch.Alarm(this, 'CircuitBreakerAlarm', {
      alarmName: `${prefix}-circuit-open-${stage}`,
      metric: new cloudwatch.Metric({
        namespace: `${prefix}/${stage}`,
        metricName: 'CircuitBreakerOpen',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    for (const alarm of [gatewayErrorAlarm, policyViolationAlarm, highLatencyAlarm, circuitBreakerAlarm]) {
      alarm.addAlarmAction(new cwActions.SnsAction(this.alarmTopic));
      alarm.addOkAction(new cwActions.SnsAction(this.alarmTopic));
    }

    // Glue Database for Athena queries on audit logs
    const glueDatabase = new glue.CfnDatabase(this, 'AuditLogsDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: `${prefix.replace(/-/g, '_')}_logs_${stage}`,
        description: 'AI Governance audit logs database',
      },
    });

    // Glue Table for audit logs (JSON format in S3)
    // The table names its database by string, so CloudFormation needs the dependency spelled out.
    const glueTable = new glue.CfnTable(this, 'AuditLogsTable', {
      catalogId: this.account,
      databaseName: `${prefix.replace(/-/g, '_')}_logs_${stage}`,
      tableInput: {
        name: 'audit_logs',
        storageDescriptor: {
          location: `s3://${auditLogBucket.bucketName}/logs/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          },
          columns: [
            { name: 'log_id', type: 'string' },
            { name: 'request_id', type: 'string' },
            { name: 'tenant_id', type: 'string' },
            { name: 'user_id', type: 'string' },
            { name: 'event_type', type: 'string' },
            { name: 'provider', type: 'string' },
            { name: 'model_id', type: 'string' },
            { name: 'policy_decision', type: 'string' },
            { name: 'pii_detected', type: 'boolean' },
            { name: 'input_tokens', type: 'int' },
            { name: 'output_tokens', type: 'int' },
            { name: 'estimated_cost', type: 'double' },
            { name: 'latency_ms', type: 'int' },
            { name: 'timestamp', type: 'string' },
          ],
        },
        partitionKeys: [
          { name: 'tenant_id', type: 'string' },
          { name: 'date', type: 'string' },
        ],
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          'projection.enabled': 'true',
          'projection.date.type': 'date',
          'projection.date.range': '2024-01-01,NOW',
          'projection.date.format': 'yyyy-MM-dd',
          'storage.location.template': `s3://${auditLogBucket.bucketName}/logs/\${tenant_id}/\${date}/`,
        },
      },
    });

    glueDatabase.node.addDependency(auditLogBucket);
    glueTable.addDependency(glueDatabase);

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home#dashboards:name=${prefix}-overview-${stage}`,
    });
  }
}
