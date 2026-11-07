#!/usr/bin/env node
/**
 * Create the first platform admin of a deployed environment (later ones can be added the same way). Cognito
 * emails them a temporary password.
 *
 *   AWS_REGION=us-east-1 node scripts/create-platform-admin.mjs <user-pool-id> <email> "<First>" "<Last>"
 *
 * The pool ID is the auth stack's UserPoolId output. Needs AWS credentials allowed cognito-idp:AdminCreateUser.
 */
import { AdminCreateUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

const [poolId, email, givenName, familyName] = process.argv.slice(2);
if (!poolId || !email || !givenName || !familyName) {
  console.error('Usage: node scripts/create-platform-admin.mjs <user-pool-id> <email> "<First>" "<Last>"');
  process.exit(2);
}
const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });
await client.send(new AdminCreateUserCommand({
  UserPoolId: poolId,
  Username: email.toLowerCase(),
  DesiredDeliveryMediums: ['EMAIL'],
  UserAttributes: [
    { Name: 'email', Value: email.toLowerCase() },
    { Name: 'email_verified', Value: 'true' },
    { Name: 'given_name', Value: givenName },
    { Name: 'family_name', Value: familyName },
    { Name: 'custom:tenantId', Value: 'tenant_platform' },
    { Name: 'custom:role', Value: 'platform_admin' },
  ],
}));
console.log(`Invited ${email} as a platform admin. They'll get an email with a temporary password.`);
