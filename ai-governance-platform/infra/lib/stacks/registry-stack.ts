import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';

/**
 * "probaline" holds the one image every service runs. The other four held the separate images before
 * 2026-11-12; they stay until the services stack no longer refers to them everywhere, then can be removed.
 */
export const SERVICE_NAMES = ['probaline', 'gateway', 'policy-engine', 'data-protection', 'analytics'] as const;
const LEGACY = ['gateway', 'policy-engine', 'data-protection', 'analytics'] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

interface RegistryStackProps extends cdk.StackProps {
  prefix: string;
  stage: string;
}

/**
 * The image repositories, in a stack of their own. The deploy workflow creates this first, pushes the images,
 * then deploys the services, so a brand-new account works from the first run.
 */
export class RegistryStack extends cdk.Stack {
  public readonly repositories: Record<ServiceName, ecr.Repository>;

  constructor(scope: Construct, id: string, props: RegistryStackProps) {
    super(scope, id, props);
    const { prefix, stage } = props;
    this.repositories = Object.fromEntries(SERVICE_NAMES.map((name) => [name, new ecr.Repository(this, `${name}Repo`, {
      repositoryName: `${prefix}-${name}-${stage}`,
      imageScanOnPush: true,
      lifecycleRules: [{ description: 'Keep the last 30 images', maxImageCount: 30 }],
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: stage !== 'prod',
    })])) as Record<ServiceName, ecr.Repository>;
    for (const name of SERVICE_NAMES) new cdk.CfnOutput(this, `${name.replace(/-/g, '')}RepoUri`, { value: this.repositories[name].repositoryUri });
    // Stacks deployed before the one image still import these; keep exporting them until every stage has moved
    // to the "probaline" repository, or CloudFormation refuses to update this stack.
    for (const name of LEGACY) {
      this.exportValue(this.repositories[name].repositoryName);
      this.exportValue(this.repositories[name].repositoryArn);
    }
  }
}
