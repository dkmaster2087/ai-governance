import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/stacks/auth-stack';

describe('AuthStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new AuthStack(app, 'TestAuthStack', {
      env: { account: '123456789012', region: 'us-east-1' },
      prefix: 'ai-gov',
      stage: 'test',
    });
    template = Template.fromStack(stack);
  });

  it('creates a Cognito User Pool', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
  });

  it('user pool requires email sign-in', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UsernameAttributes: ['email'],
    });
  });

  it('user pool enforces strong password policy', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: {
        PasswordPolicy: {
          MinimumLength: 12,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        },
      },
    });
  });

  it('creates 3 user groups (admin, auditor, developer)', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolGroup', 3);
  });

  it('creates a user pool client', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
  });

  it('lets the client write every required attribute (Cognito refuses the client otherwise), but not company or role', () => {
    const client = Object.values(template.findResources('AWS::Cognito::UserPoolClient'))[0] as any;
    const writes: string[] = client.Properties.WriteAttributes;
    expect(writes).toEqual(expect.arrayContaining(['email', 'given_name', 'family_name']));
    expect(writes.some((w) => w.startsWith('custom:'))).toBe(false);
  });

  it('self sign-up is disabled', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });
});
