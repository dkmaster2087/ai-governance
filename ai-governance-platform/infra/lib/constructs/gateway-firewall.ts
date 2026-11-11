import * as cdk from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * AWS WAF in front of the gateway's public load balancer.
 *
 * AI prompts are large and full of code, so AWS's rules that inspect request bodies (size, script, file
 * paths, Log4j strings) only count, never block: the gateway inspects bodies itself. Headers, paths and
 * query strings are checked, known bad sources are refused, and each address is rate limited.
 */
const BODY_RULES_COMMON = ['SizeRestrictions_BODY', 'CrossSiteScripting_BODY', 'GenericLFI_BODY', 'GenericRFI_BODY', 'EC2MetaDataSSRF_BODY', 'NoUserAgent_HEADER'];
const BODY_RULES_BAD_INPUTS = ['Log4JRCE_BODY', 'JavaDeserializationRCE_BODY'];

export interface GatewayFirewallProps {
  prefix: string;
  stage: string;
  loadBalancer: elbv2.IApplicationLoadBalancer;
  /** Requests per address in any 5 minutes before it's refused (default 3000). */
  ratePerFiveMinutes?: number;
  /**
   * The secret CloudFront adds. Requests carrying it are left out of the per-address limit: to the firewall they
   * all come from a few CloudFront addresses, so one busy location would block everyone using it. The gateway
   * still limits them per person's address.
   */
  edgeSecret?: secretsmanager.ISecret;
}

export class GatewayFirewall extends Construct {
  readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: GatewayFirewallProps) {
    super(scope, id);
    const visibility = (metricName: string) => ({ cloudWatchMetricsEnabled: true, sampledRequestsEnabled: true, metricName });
    const managed = (name: string, priority: number, countOnly: string[] = []): wafv2.CfnWebACL.RuleProperty => ({
      name, priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS', name,
          ...(countOnly.length ? { ruleActionOverrides: countOnly.map((n) => ({ name: n, actionToUse: { count: {} } })) } : {}),
        },
      },
      visibilityConfig: visibility(name),
    });

    this.webAcl = new wafv2.CfnWebACL(this, 'Acl', {
      name: `${props.prefix}-gateway-${props.stage}`,
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: visibility(`${props.prefix}-gateway-${props.stage}`),
      rules: [
        {
          name: 'RatePerAddress', priority: 0,
          action: { block: { customResponse: { responseCode: 429 } } },
          statement: {
            rateBasedStatement: {
              limit: props.ratePerFiveMinutes ?? 3000, aggregateKeyType: 'IP',
              ...(props.edgeSecret ? {
                scopeDownStatement: {
                  notStatement: {
                    statement: {
                      byteMatchStatement: {
                        fieldToMatch: { singleHeader: { Name: 'x-probaline-edge' } },
                        positionalConstraint: 'EXACTLY',
                        searchString: props.edgeSecret.secretValue.unsafeUnwrap(),
                        textTransformations: [{ priority: 0, type: 'NONE' }],
                      },
                    },
                  },
                },
              } : {}),
            },
          },
          visibilityConfig: visibility('RatePerAddress'),
        },
        managed('AWSManagedRulesAmazonIpReputationList', 1),
        managed('AWSManagedRulesCommonRuleSet', 2, BODY_RULES_COMMON),
        managed('AWSManagedRulesKnownBadInputsRuleSet', 3, BODY_RULES_BAD_INPUTS),
      ],
    });

    new wafv2.CfnWebACLAssociation(this, 'Association', {
      resourceArn: props.loadBalancer.loadBalancerArn,
      webAclArn: this.webAcl.attrArn,
    });
    new cdk.CfnOutput(scope, 'GatewayWebAclArn', { value: this.webAcl.attrArn });
  }
}
