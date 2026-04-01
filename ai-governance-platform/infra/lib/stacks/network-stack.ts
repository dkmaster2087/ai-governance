import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

interface NetworkStackProps extends cdk.StackProps {
  prefix: string;
  stage: string;
}

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { prefix, stage } = props;

    /**
     * VPC: 2 public + 4 private subnets across 2 AZs
     * Single NAT Gateway for cost optimization (dev/test)
     * For production: set natGateways: 2 (one per AZ)
     */
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${prefix}-vpc-${stage}`,
      maxAzs: 2,
      natGateways: 1, // Single NAT GW — cost optimized for dev/test
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          // Private subnets for ECS services (with NAT for outbound)
          name: 'Private-App',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          // Isolated subnets for databases (no internet access)
          name: 'Private-Data',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      // VPC Flow Logs for security auditing
      flowLogs: {
        FlowLog: {
          trafficType: ec2.FlowLogTrafficType.ALL,
        },
      },
    });

    // VPC Endpoints to avoid NAT costs for AWS services
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    this.vpc.addGatewayEndpoint('DynamoDBEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // Interface endpoints for Bedrock and other services
    this.vpc.addInterfaceEndpoint('BedrockEndpoint', {
      service: new ec2.InterfaceVpcEndpointService(
        `com.amazonaws.${this.region}.bedrock-runtime`
      ),
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      privateDnsEnabled: true,
    });

    this.vpc.addInterfaceEndpoint('ComprehendEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.COMPREHEND,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      privateDnsEnabled: true,
    });

    // Outputs
    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId, exportName: `${prefix}-vpc-id-${stage}` });
    new cdk.CfnOutput(this, 'VpcCidr', { value: this.vpc.vpcCidrBlock });
  }
}
