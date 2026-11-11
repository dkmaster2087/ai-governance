import { Category, serviceById } from '@ai-governance/catalog';

/**
 * The AWS lock: an organization service control policy (SCP) that denies direct model calls to everyone except
 * the gateway's role and a named emergency role, a matching VPC endpoint policy, and a CloudFormation template
 * that creates the SCP in the management account. Probaline writes them; the customer reviews and applies them.
 */

export interface AwsLockInput {
  gatewayRoleArn: string;
  /** An emergency role that keeps direct access if the gateway is down. Strongly recommended. */
  breakGlassRoleArn?: string;
  /** OUs (ou-…), the root (r-…) or accounts to attach the SCP to. Start with one OU. */
  targetIds?: string[];
  /** Also lock SageMaker endpoints. Default true. */
  sagemaker?: boolean;
}

export const ROLE_ARN = /^arn:aws(-[a-z]+)*:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/;
export const TARGET_ID = /^(ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}|r-[0-9a-z]{4,32}|\d{12})$/;
/** AWS's limit on an SCP document, counted without whitespace. */
export const SCP_MAX_CHARS = 5120;

export const BEDROCK_ACTIONS = ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:CreateModelInvocationJob'];
export const SAGEMAKER_ACTIONS = ['sagemaker:InvokeEndpoint', 'sagemaker:InvokeEndpointAsync', 'sagemaker:InvokeEndpointWithResponseStream'];

export class LockInputError extends Error {}

export function checkInput(input: AwsLockInput): AwsLockInput {
  if (!ROLE_ARN.test(input.gatewayRoleArn ?? '')) throw new LockInputError('The gateway role must be an IAM role ARN, like arn:aws:iam::123456789012:role/probaline-gateway-task');
  if (input.breakGlassRoleArn && !ROLE_ARN.test(input.breakGlassRoleArn)) throw new LockInputError('The emergency role must be an IAM role ARN');
  if (input.breakGlassRoleArn && input.breakGlassRoleArn === input.gatewayRoleArn) throw new LockInputError('The emergency role must be a different role from the gateway’s');
  const bad = (input.targetIds ?? []).find((t) => !TARGET_ID.test(t));
  if (bad) throw new LockInputError(`Not an OU, root or account ID: ${bad}`);
  return input;
}

const allowed = (i: AwsLockInput) => [i.gatewayRoleArn, ...(i.breakGlassRoleArn ? [i.breakGlassRoleArn] : [])];
const actions = (i: AwsLockInput) => [...BEDROCK_ACTIONS, ...(i.sagemaker === false ? [] : SAGEMAKER_ACTIONS)];

export function serviceControlPolicy(input: AwsLockInput) {
  const i = checkInput(input);
  return {
    Version: '2012-10-17',
    Statement: [{
      Sid: 'ProbalineModelCallsOnlyThroughGateway',
      Effect: 'Deny',
      Action: actions(i),
      Resource: '*',
      // aws:PrincipalArn is the role ARN for every session of the role, so sessions can't slip through.
      Condition: { ArnNotLike: { 'aws:PrincipalArn': allowed(i) } },
    }],
  };
}

/** For bedrock-runtime and sagemaker.runtime interface endpoints, so calls inside the VPC are held to the same rule. */
export function vpcEndpointPolicy(input: AwsLockInput) {
  const i = checkInput(input);
  return {
    Version: '2012-10-17',
    Statement: [{
      Sid: 'ProbalineGatewayOnly',
      Effect: 'Allow',
      Principal: { AWS: '*' },
      Action: actions(i),
      Resource: '*',
      Condition: { ArnLike: { 'aws:PrincipalArn': allowed(i) } },
    }],
  };
}

/** A CloudFormation template for the management account (or a delegated administrator for Organizations). */
export function cloudFormationTemplate(input: AwsLockInput) {
  const i = checkInput(input);
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Probaline: model calls only through the Probaline gateway (service control policy).',
    Parameters: {
      TargetIds: {
        Type: 'CommaDelimitedList',
        Description: 'OU, root or account IDs to attach the policy to. Start with one OU.',
        ...(i.targetIds?.length ? { Default: i.targetIds.join(',') } : {}),
      },
    },
    Resources: {
      ProbalineModelLock: {
        Type: 'AWS::Organizations::Policy',
        Properties: {
          Name: 'probaline-model-calls-through-gateway',
          Description: 'Denies Bedrock and SageMaker model calls except from the Probaline gateway role and the emergency role.',
          Type: 'SERVICE_CONTROL_POLICY',
          Content: serviceControlPolicy(i),
          TargetIds: { Ref: 'TargetIds' },
        },
      },
    },
  };
}

/** Structural checks we can make without AWS: size, shape, and that the gateway is never denied. */
export function checkPolicy(scp: ReturnType<typeof serviceControlPolicy>, input: AwsLockInput): string[] {
  const problems: string[] = [];
  const size = JSON.stringify(scp).length;
  if (size > SCP_MAX_CHARS) problems.push(`The policy is ${size} characters; AWS allows ${SCP_MAX_CHARS}.`);
  for (const s of scp.Statement) {
    if (s.Effect !== 'Deny') continue;
    const exempt = s.Condition?.ArnNotLike?.['aws:PrincipalArn'] ?? [];
    if (!exempt.includes(input.gatewayRoleArn)) problems.push('The gateway role would be denied.');
    if (s.Action.some((a) => !/^(bedrock|sagemaker):[A-Za-z*]+$/.test(a))) problems.push('An action outside Bedrock and SageMaker is listed.');
  }
  return problems;
}

export interface AwsLockFiles {
  serviceControlPolicy: object;
  vpcEndpointPolicy: object;
  cloudFormation: object;
  problems: string[];
  notes: string[];
}

export function generateAwsLock(input: AwsLockInput): AwsLockFiles {
  const i = checkInput(input);
  const scp = serviceControlPolicy(i);
  return {
    serviceControlPolicy: scp,
    vpcEndpointPolicy: vpcEndpointPolicy(i),
    cloudFormation: cloudFormationTemplate(i),
    problems: checkPolicy(scp, i),
    notes: [
      ...(i.breakGlassRoleArn ? [] : ['No emergency role: if the gateway is down, nobody in the targeted accounts can call models directly. Add one before attaching to production.']),
      'Attach to one OU first and watch the collector report for a few days before attaching wider.',
      'SCPs don’t apply to the management account or to service-linked roles. Bedrock agents and knowledge bases call models with their own service roles: add those roles to the exceptions if you use them.',
      'Model calls from other clouds and from the internet are locked by the AI-domain feed, not this policy.',
    ],
  };
}

// ── Preview from a collector findings file ────────────────────────────────────────────────────────────────

/** The parts of a collector findings file the previews read (collector/src/core/findings.ts). */
export interface FindingsLike {
  to?: string;
  catalogVersion?: string;
  services?: Array<{ id: string; name: string; category: Category; people: number; machines: number; count: number }>;
  cloudAi?: Array<{ who: string; services: string[]; count: number }>;
  directApi?: Array<{ who: string; services: string[]; count: number }>;
  paths?: Array<{ id: string; stillDirect: Array<{ who: string; services: string[]; count: number }> }>;
}

export interface WouldBeBlocked {
  who: string;
  services: string[];
  count: number;
  /** For the AWS lock: whether the log named the identity the SCP checks (a role or a person), or only a host or IP. */
  identityKnown?: boolean;
}

const roleName = (arn?: string) => arn?.split('/').pop()?.toLowerCase();

/** Who calls Bedrock or SageMaker directly and isn't the gateway or the emergency role: they'd be refused. */
export function awsLockPreview(findings: FindingsLike, input: Pick<AwsLockInput, 'gatewayRoleArn' | 'breakGlassRoleArn'>): WouldBeBlocked[] {
  const exempt = new Set([roleName(input.gatewayRoleArn), roleName(input.breakGlassRoleArn)].filter(Boolean).map((n) => `role:${n}`));
  const callers = findings.paths?.find((p) => p.id === 'cloud_ai')?.stillDirect ?? findings.cloudAi ?? [];
  return callers
    .filter((c) => c.services.some((s) => /Bedrock|SageMaker/i.test(s)) && !exempt.has(c.who.toLowerCase()))
    .map((c) => ({ who: c.who, services: c.services, count: c.count, identityKnown: c.who.startsWith('role:') || c.who.startsWith('user-') }))
    .sort((a, b) => b.count - a.count);
}

/** What a feed with these categories would stop: services in use, and apps calling model APIs directly. */
export function feedPreview(findings: FindingsLike, categories: Category[], approvedIds: string[] = []) {
  const wanted = new Set(categories);
  const approved = new Set(approvedIds.map((id) => serviceById(id)?.id ?? id));
  const services = (findings.services ?? [])
    .filter((s) => wanted.has(s.category) && !approved.has(s.id) && !/^aws-/.test(s.id))
    .map((s) => ({ id: s.id, name: s.name, people: s.people, machines: s.machines, count: s.count }))
    .sort((a, b) => b.count - a.count);
  const apps: WouldBeBlocked[] = wanted.has('model_api')
    ? (findings.paths?.find((p) => p.id === 'model_api')?.stillDirect ?? findings.directApi ?? []).map((c) => ({ who: c.who, services: c.services, count: c.count }))
    : [];
  return { services, apps };
}
