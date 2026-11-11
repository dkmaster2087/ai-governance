import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

/**
 * The keys Probaline's services sign and check internal calls with (shared/utils/src/internal-auth.ts).
 *
 * - signingKey: the gateway's private key. Only the gateway is given it.
 * - trustedKeys: the public keys every internal service accepts.
 *
 * Made once, on first deploy, by a small function; later deploys never touch them, so a rotation done with
 * scripts/internal-keys.mjs isn't undone.
 */
const HANDLER = `
const { generateKeyPairSync } = require('crypto');
const { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const sm = new SecretsManagerClient({});
exports.handler = async (event) => {
  if (event.RequestType !== 'Create') return { PhysicalResourceId: event.PhysicalResourceId };
  const { SigningSecret, TrustedSecret } = event.ResourceProperties;
  const current = await sm.send(new GetSecretValueCommand({ SecretId: SigningSecret })).then((r) => r.SecretString, () => '');
  if (!current.includes('PRIVATE KEY')) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    await sm.send(new PutSecretValueCommand({ SecretId: SigningSecret, SecretString: JSON.stringify({ iss: 'gateway', privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) }) }));
    await sm.send(new PutSecretValueCommand({ SecretId: TrustedSecret, SecretString: JSON.stringify([{ iss: 'gateway', publicKey: publicKey.export({ format: 'pem', type: 'spki' }) }]) }));
  }
  return { PhysicalResourceId: 'probaline-internal-keys' };
};`;

export class InternalKeys extends Construct {
  readonly signingKey: secretsmanager.Secret;
  readonly trustedKeys: secretsmanager.Secret;
  /** Depend on this so services start only once the keys exist. */
  readonly ready: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: { prefix: string; stage: string; removalPolicy: cdk.RemovalPolicy }) {
    super(scope, id);
    const { prefix, stage, removalPolicy } = props;
    this.signingKey = new secretsmanager.Secret(this, 'SigningKey', {
      secretName: `${prefix}/${stage}/internal-signing-key`,
      description: 'The gateway’s private key for calls to internal services (ES256). Only the gateway reads it.',
      removalPolicy,
    });
    this.trustedKeys = new secretsmanager.Secret(this, 'TrustedKeys', {
      secretName: `${prefix}/${stage}/internal-trusted-keys`,
      description: 'Public keys internal services accept tokens from.',
      removalPolicy,
    });
    const fn = new lambda.Function(this, 'MakeKeys', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(HANDLER),
      timeout: cdk.Duration.seconds(30),
      logRetention: logs.RetentionDays.ONE_MONTH,
    });
    this.signingKey.grantRead(fn);
    this.signingKey.grantWrite(fn);
    this.trustedKeys.grantWrite(fn);
    const provider = new cr.Provider(this, 'Provider', { onEventHandler: fn, logRetention: logs.RetentionDays.ONE_MONTH });
    this.ready = new cdk.CustomResource(this, 'Keys', {
      serviceToken: provider.serviceToken,
      properties: { SigningSecret: this.signingKey.secretArn, TrustedSecret: this.trustedKeys.secretArn },
    });
  }
}
