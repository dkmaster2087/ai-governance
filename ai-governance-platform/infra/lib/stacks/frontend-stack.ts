import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface FrontendStackProps extends cdk.StackProps {
  prefix: string;
  stage: string;
  loadBalancer: elbv2.IApplicationLoadBalancer;
}

export const SITES = ['website', 'dashboard', 'docs'] as const;
export type Site = (typeof SITES)[number];

/**
 * The three web front ends: the sales website, the dashboard and the docs site. Each is files in a private
 * bucket behind CloudFront. The dashboard and the website also send `/api/*` to the gateway, so the dashboard
 * works exactly as it does locally and browsers never need cross-origin access.
 *
 * Context (all optional): websiteDomain, dashboardDomain, docsDomain, cloudfrontCertificateArn (us-east-1,
 * covering those names), gatewayUrl (https address of the gateway; without it CloudFront reaches the load
 * balancer over plain HTTP, fine for dev only).
 */
export class FrontendStack extends cdk.Stack {
  public readonly buckets = {} as Record<Site, s3.Bucket>;
  public readonly distributions = {} as Record<Site, cloudfront.Distribution>;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);
    const { prefix, stage } = props;
    const ctx = (k: string): string | undefined => this.node.tryGetContext(k) || undefined;
    const certArn = ctx('cloudfrontCertificateArn');
    const certificate = certArn ? acm.Certificate.fromCertificateArn(this, 'Certificate', certArn) : undefined;
    const gatewayUrl = ctx('gatewayUrl');
    if (stage === 'prod' && !gatewayUrl) throw new Error('Production needs -c gatewayUrl=https://… so CloudFront reaches the gateway over HTTPS');

    // Single-page apps: any path without a file extension is the app.
    const spa = new cloudfront.Function(this, 'SpaRewrite', {
      comment: 'Serve index.html for app routes',
      code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var r = event.request;
  if (r.uri.indexOf('.') === -1) { r.uri = '/index.html'; }
  return r;
}`),
    });
    // /api/v1/... at the front end is /v1/... at the gateway.
    const stripApi = new cloudfront.Function(this, 'StripApiPrefix', {
      comment: 'Remove /api before sending to the gateway',
      code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var r = event.request;
  r.uri = r.uri.replace(/^\\/api/, '') || '/';
  return r;
}`),
    });
    const gatewayOrigin = gatewayUrl
      ? new origins.HttpOrigin(new URL(gatewayUrl).hostname, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY })
      : new origins.HttpOrigin(props.loadBalancer.loadBalancerDnsName, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY });
    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: gatewayOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      functionAssociations: [{ function: stripApi, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
    };
    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(365), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      },
    });

    for (const site of SITES) {
      const bucket = new s3.Bucket(this, `${site}Bucket`, {
        bucketName: undefined,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: stage !== 'prod',
      });
      const domain = ctx(`${site}Domain`);
      const distribution = new cloudfront.Distribution(this, `${site}Distribution`, {
        comment: `${prefix} ${site} (${stage})`,
        defaultRootObject: 'index.html',
        ...(domain && certificate ? { domainNames: [domain], certificate } : {}),
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: headers,
          functionAssociations: [{ function: spa, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        },
        ...(site === 'docs' ? {} : { additionalBehaviors: { '/api/*': apiBehavior } }),
      });
      this.buckets[site] = bucket;
      this.distributions[site] = distribution;
      const url = domain && certificate ? `https://${domain}` : `https://${distribution.distributionDomainName}`;
      new cdk.CfnOutput(this, `${site}BucketName`, { value: bucket.bucketName });
      new cdk.CfnOutput(this, `${site}DistributionId`, { value: distribution.distributionId });
      new cdk.CfnOutput(this, `${site}Url`, { value: url });
    }
  }
}
