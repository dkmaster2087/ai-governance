import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';

interface ApiStackProps extends cdk.StackProps {
  prefix: string;
  stage: string;
  gatewayService: ecs.FargateService;
  userPool: cognito.UserPool;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { prefix, stage, userPool } = props;

    this.api = new apigw.RestApi(this, 'Api', {
      restApiName: `${prefix}-api-${stage}`,
      description: 'AI Governance Platform API',
      deployOptions: {
        stageName: stage,
        throttlingRateLimit: 1000,
        throttlingBurstLimit: 500,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false, // Don't log request bodies (PII risk)
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Tenant-Id',
          'X-User-Id',
          'X-App-Id',
        ],
      },
    });

    // Cognito authorizer
    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: `${prefix}-authorizer-${stage}`,
    });

    // Usage plan for API key management (enterprise clients)
    const usagePlan = this.api.addUsagePlan('EnterprisePlan', {
      name: `${prefix}-enterprise-${stage}`,
      throttle: { rateLimit: 500, burstLimit: 200 },
      quota: { limit: 1000000, period: apigw.Period.MONTH },
    });

    // API key for on-prem/enterprise deployments
    const apiKey = this.api.addApiKey('EnterpriseApiKey', {
      apiKeyName: `${prefix}-enterprise-key-${stage}`,
    });
    usagePlan.addApiKey(apiKey);

    // Proxy all /v1/* to the gateway ALB
    // In production, use VpcLink to connect to internal ALB
    const v1 = this.api.root.addResource('v1');
    const proxy = v1.addResource('{proxy+}');

    proxy.addMethod('ANY', new apigw.MockIntegration({
      // Replace with HttpIntegration pointing to ALB in production
      integrationResponses: [{ statusCode: '200' }],
      passthroughBehavior: apigw.PassthroughBehavior.WHEN_NO_MATCH,
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
    }), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: this.api.url });
    new cdk.CfnOutput(this, 'ApiId', { value: this.api.restApiId });
  }
}
