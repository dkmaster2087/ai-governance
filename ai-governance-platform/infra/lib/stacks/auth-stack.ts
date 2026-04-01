import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

interface AuthStackProps extends cdk.StackProps {
  prefix: string;
  stage: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { prefix, stage } = props;

    // Cognito User Pool for SaaS multi-tenant auth
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${prefix}-users-${stage}`,
      selfSignUpEnabled: false, // Admin-controlled onboarding
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
      },
      customAttributes: {
        tenantId: new cognito.StringAttribute({ mutable: false }),
        role: new cognito.StringAttribute({ mutable: true }),
        deploymentMode: new cognito.StringAttribute({ mutable: false }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // App client for the dashboard
    this.userPoolClient = this.userPool.addClient('DashboardClient', {
      userPoolClientName: `${prefix}-dashboard-${stage}`,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          `https://dashboard.${prefix}.com/callback`,
          'http://localhost:5173/callback', // Local dev
        ],
        logoutUrls: [
          `https://dashboard.${prefix}.com`,
          'http://localhost:5173',
        ],
      },
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
    });

    // Groups for RBAC
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      description: 'Platform administrators',
    });

    new cognito.CfnUserPoolGroup(this, 'AuditorGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'auditor',
      description: 'Read-only audit access',
    });

    new cognito.CfnUserPoolGroup(this, 'DeveloperGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'developer',
      description: 'API access for developers',
    });

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId, exportName: `${prefix}-user-pool-id-${stage}` });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
  }
}
