import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { ObservabilityStack } from '../lib/stacks/observability-stack';

describe('ObservabilityStack', () => {
  const app = new cdk.App();
  const base = new cdk.Stack(app, 'Base', { env: { account: '123456789012', region: 'us-east-1' } });
  const vpc = new ec2.Vpc(base, 'Vpc');
  const loadBalancer = new elbv2.ApplicationLoadBalancer(base, 'Alb', { vpc, internetFacing: true });
  const bucket = new s3.Bucket(base, 'Audit');
  const stack = new ObservabilityStack(app, 'Obs', {
    env: { account: '123456789012', region: 'us-east-1' }, prefix: 'probaline', stage: 'prod',
    auditLogBucket: bucket, loadBalancer, alarmEmail: 'ops@example.com',
  });
  const template = Template.fromStack(stack);

  it('emails the operator, and every alarm notifies the topic', () => {
    template.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'ops@example.com' });
    const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm')) as any[];
    expect(alarms).toHaveLength(4);
    for (const a of alarms) expect(a.Properties.AlarmActions).toHaveLength(1);
  });

  it('watches the gateway load balancer and the metrics the gateway publishes', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'HTTPCode_Target_5XX_Count', Dimensions: Match.arrayWith([Match.objectLike({ Name: 'LoadBalancer' })]),
    });
    for (const name of ['PolicyViolations', 'RequestLatency', 'CircuitBreakerOpen']) {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', { MetricName: name, Namespace: 'probaline/prod' });
    }
  });
});
