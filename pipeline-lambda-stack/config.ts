import * as fs from 'fs';
import * as cdk from "aws-cdk-lib";
import {CfnParameter, Environment} from "aws-cdk-lib";
import {ILambdaDeploymentConfig, LambdaDeploymentConfig} from "aws-cdk-lib/aws-codedeploy";
import * as iam from "aws-cdk-lib/aws-iam";
import {Role} from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import {Construct} from "constructs";
import {sanitizeIamRoleName} from "./lib/utils/utils";
import {hostname} from "os";
import {Optional} from "typescript-optional";

export class Config implements IConfig {
  /** The main configuration file */
  static PARAM_FILEPATH = 'parameters.json';
  static env = {
    account: process.env.CDK_DEFAULT_ACCOUNT || null,
    region: process.env.CDK_DEFAULT_REGION || null,
  };
  static readonly DeploymentConfigMap = {
    'deployConfigAllAtOnce': LambdaDeploymentConfig.ALL_AT_ONCE,
    /** CodeDeploy predefined deployment configuration that shifts 10 percent of traffic in the first increment. The remaining 90 percent is deployed five minutes later. */
    'canary10Percent5Minutes': LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
    'canary10Percent10Minutes': LambdaDeploymentConfig.CANARY_10PERCENT_10MINUTES,
    'canary10Percent15Minutes': LambdaDeploymentConfig.CANARY_10PERCENT_15MINUTES,
    'canary10Percent30Minutes': LambdaDeploymentConfig.CANARY_10PERCENT_30MINUTES,
    'linear10PercentEvery1Minute': LambdaDeploymentConfig.LINEAR_10PERCENT_EVERY_1MINUTE,
    'linear10PercentEvery2Minute': LambdaDeploymentConfig.LINEAR_10PERCENT_EVERY_2MINUTES,
    'linear10PercentEvery3Minute': LambdaDeploymentConfig.LINEAR_10PERCENT_EVERY_3MINUTES,
    'linear10PercentEvery10Minutes': LambdaDeploymentConfig.LINEAR_10PERCENT_EVERY_10MINUTES,
  };

  private static _rolesMap: PipelineRoles = {
    lambdaExecutionRole: {} as iam.Role,
    pipelineRole: {} as iam.Role,
    projectExecutionRole: {} as iam.Role,
    sourceRole: {} as iam.Role,
    codedeployExecutionRole: {} as iam.Role,
    deployRole: {} as iam.Role,
    buildRole: {} as iam.Role,
  };

  static _params: ISettingParams | null = null;

  private _stack: cdk.Stack;

  public constructor() {
    this.setStack = this.setStack.bind(this)
    this.mkRoles = this.mkRoles.bind(this)
  }

  get params(): ISettingParams {
    return (!Config._params) ? Config._params = this.loadParameters<{}>() : Config._params
  }

  get stack(): cdk.Stack {
    if (!this._stack) {
      throw new Error("Call `setStack(stack)` before calling CFN related methods")
    }
    return this._stack
  }

  get roles(): PipelineRoles {
    if (!Config._rolesMap.buildRole) {
      if (this.stack) {
        // this.loadRoles<{}>()
      } else {
        throw new Error("Call `setStack(stack)` before calling CFN related methods")
      }
    }
    return Config._rolesMap
  }

  get deploymentConfig(): ILambdaDeploymentConfig {
    const dName = this.params.deploymentConfigName;
    const dc = /.+/.test(dName)
    ? (dName in Config.DeploymentConfigMap) ? Config.DeploymentConfigMap[<keyof (typeof Config.DeploymentConfigMap)>dName] : LambdaDeploymentConfig.fromLambdaDeploymentConfigName(this.stack, "CustomConfig", dName)
    : LambdaDeploymentConfig.ALL_AT_ONCE
    return dc
  }

  setStack<T>(stack: cdk.Stack): IConfig {
    this._stack = stack
    this.loadParameters<ISettingParams & T>()
    this.setSecrets(stack)
    return this;
  }

  private setSecrets(stack: cdk.Stack) {
    if (Config._params) {
      Config._params['devopsEmail'] = Optional.ofNullable(stack.node.tryGetContext('devopsEmail') as string)
      .orElseGet(() => {
        let tempStr: string | null = Config._params?.['devopsEmailArnParam'] as string;
        if (tempStr != null) {
          tempStr = ssm.StringParameter.valueForStringParameter(stack, tempStr)
        }
        return tempStr || `admin@${hostname()}`;
      });

      Config._params['handlerConnectionArn'] = ssm.StringParameter.valueForStringParameter(this._stack, this.params.handlerConnectionArnParam as string)
    }
  }

  public mkRoles(props: { bucketArn?: string; connectionArn: string; }): PipelineRoles {
    const { region, account } = this.params.env
    const pipeRoles = createPipelineRoles(this.stack,{ ...props, region, account, functionName: this.params.lambdaFunctionName })
    const lambdaExecutionRoleArn = this.params[<AParamName>'lambdaExecutionRoleArn'] as string;

    Config._rolesMap['lambdaExecutionRole'] = Role.fromRoleArn(this.stack, `lambdaExecutionRole`, lambdaExecutionRoleArn) as Role;
    Config._rolesMap['pipelineRole'] = pipeRoles['pipelineRole'];
    Config._rolesMap['sourceRole'] = pipeRoles['sourceRole'];
    Config._rolesMap['codedeployExecutionRole'] = pipeRoles['codedeployExecutionRole'];
    Config._rolesMap['deployRole'] = pipeRoles['deployRole'];
    Config._rolesMap['buildRole'] = pipeRoles['buildRole'];
    Config._rolesMap['projectExecutionRole'] = pipeRoles['projectExecutionRole'];
    return Config._rolesMap;
  }

  private loadParameters<R>(): ISettingParams & R {
    const fileContent: string = fs.readFileSync(Config.PARAM_FILEPATH, 'utf-8');
    const cfnParameters: CfnParameter[] = [];
    const resolvedContent = fileContent
    .replace(/{{ACCOUNT}}/g, process.env.CDK_DEFAULT_ACCOUNT || this.stack.account)
    .replace(/{{REGION}}/g, process.env.CDK_DEFAULT_REGION || this.stack.region);

    const valueNotBlank = (paramData: IParameter) => /.+/.test(paramData['default'])
    const setValue = (paramData: IParameter) => (<IParameter>{
      ...paramData,
      'default': ((/Number/i).test(paramData['type'] ?? 'string')) ? Number(paramData['default']) : paramData['default']
    })

    const rawParams = JSON.parse(resolvedContent).reduce((
      agg: Partial<ISettingParams & R>, paramData: IParameter) => {
      [paramData]
      .filter(valueNotBlank)
      .map(setValue)
      .forEach(it => {
        if (this._stack) {
          cfnParameters.push(new CfnParameter(this._stack, it.ParameterKey, it))
        }
        agg[it.ParameterKey] = it['default']
      })
      return agg
    }, { env: {...Config.env} } as Partial<ISettingParams & R>);

    const lambdaFunctionName = [process.env?.lambdaFunctionName || rawParams.lambdaFunctionName]
      .filter(str => /\w+/.test(str))
      .pop();

    if (!lambdaFunctionName) throw new Error("Set function name in parameters.json")

    if (rawParams?.buildTimeout < 10) {
      console.warn("`buildTimeout` is set to 30 seconds");
      rawParams.buildTimeout = 30
    }

    if (rawParams?.memorySize < 128) {
      console.warn("`memorySize` must have value greater than or equal to 128. Resetting value to 128 (MB)");
      rawParams.memorySize = 128
    }


    //  || `admin@${hostname()}`
    return Config._params = {
      ...Config._params,
      ...rawParams,
      lambdaFunctionName,

      /** WIP / Experimental */
      // notifierPath: 'lib/templates/lambda/',
      // // topicName: 'arn:aws:sns:us-west-2:009072398085:VanillaStack-TestFailureTopicA800E84D-4cnnQSW8yoaX',
      // topicName: 'TestFailureTopic',

      // Internal vars
      /** suffix of name used in testAction CodeBuild */
      errorFileNameSuffix: 'test_results.json',
      /** name of folder on S3 where test reports are saved */
      objectKey: "Reports",


      applicationName: rawParams.applicationName || `${lambdaFunctionName}Application`,
      deploymentGroupName: `${lambdaFunctionName}DG`,
      lambdaStackName: `${lambdaFunctionName}Stack`,
      lambdaConstructName: `${lambdaFunctionName}Construct`,
      pipelineName: `${lambdaFunctionName}Pipeline`,
      pipelineStackName: `${lambdaFunctionName}PipelineStack`,
    }
  }
}

export type AppEnvironment = { account: string; region: string; } & Environment;

export interface ISettingParams extends IConnectionKeys {
  env: AppEnvironment;
  lambdaAliasName: string;
  applicationName: string;
  memorySize: number;
  buildTimeout: number;
  buildSpecPath: string;
  handlerRepoURL: string;
  handlerBranch: string;
  projectBucket: string;
  handlerConnectionArn: string;
  lambdaFunctionName: string;
  deploymentConfigName: string;
  handlerConnectionArnParam: string;
  devopsEmailArnParam: string;


  // Internal vars
  /** suffix of name used in testAction CodeBuild */
  errorFileNameSuffix: string;
  /** name of folder on S3 where test reports are saved */
  objectKey: string


  // Made
  devopsEmail: string;
  deploymentGroupName: string;
  pipelineName: string;
  pipelineStackName: string;
  lambdaStackName: string;
}

export interface IParameter extends cdk.CfnParameterProps {
  ParameterKey: keyof ISettingParams;
}

export interface IConnectionKeys {
  handlerConnectionArnParam?: string;
}

export type AParamName = keyof ISettingParams

export interface PipelineRoles {
  lambdaExecutionRole?: iam.Role;
  pipelineRole: iam.Role;
  sourceRole: iam.Role;
  buildRole: iam.Role;
  deployRole: iam.Role;
  projectExecutionRole: iam.Role;
  codedeployExecutionRole: iam.Role;
}

export interface IConfig {
  stack: cdk.Stack;
  roles: PipelineRoles;
  params: ISettingParams;
  deploymentConfig: ILambdaDeploymentConfig;
  setStack: <T>(stack: cdk.Stack) => IConfig;
}

export function createPipelineRoles(scope: Construct, props: {
  bucketArn?: string;
  connectionArn: string;
  functionName: string;
  region: string;
  account: string;
}): PipelineRoles {
  const {bucketArn, connectionArn, functionName, region, account} = props;

  const myFunctionArnBase = `arn:aws:lambda:${region}:${account}:function`

  const mkRoleName = (name: string) => {
    return sanitizeIamRoleName(`AIO${functionName}${name}`)
  }

  const pipelineRole = new iam.Role(scope, 'PipelineRole', {
    roleName: mkRoleName('PipelineRole'),
    assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
    description: 'Pipeline-level role'
  });

  const codedeployExecutionRole = new iam.Role(scope, 'LambdaDeployExecutionRole', {
    roleName: mkRoleName('CDExecRole'),
    assumedBy: new iam.CompositePrincipal(
      new iam.ServicePrincipal('codedeploy.amazonaws.com'),
      new iam.ArnPrincipal(pipelineRole.roleArn)
    ),

  });

  // Add these permissions to the CodeDeploy execution role
  codedeployExecutionRole.addToPolicy(new iam.PolicyStatement({
    actions: [
      'lambda:GetFunction',
      'lambda:UpdateFunctionCode',
      'lambda:PublishVersion',
      'lambda:UpdateAlias',
      'codedeploy:CreateDeployment',
      'codedeploy:GetDeployment',
      'codedeploy:GetDeploymentConfig',
      'codedeploy:RegisterApplicationRevision',
      'codedeploy:GetApplicationRevision',
      "s3:GetBucket*",
      "s3:GetObject*",
      "s3:List*",
      's3:GetObjectVersion',
      's3:GetBucketVersioning',
      's3:GetBucketLocation'
    ],
    resources: [
      `${bucketArn}`,
      `${bucketArn}/*`,
      `arn:aws:lambda:${region}:${account}:function:${functionName}*`,
      `arn:aws:codedeploy:${region}:${account}:application:${functionName}*`,
      `arn:aws:codedeploy:${region}:${account}:deploymentconfig:*`,
      `arn:aws:codedeploy:${region}:${account}:deploymentgroup:${functionName}*`
    ]
  }));

  const sourceRole = new iam.Role(scope, 'SourceActionRole', {
    roleName: mkRoleName('SourceRole'),
    assumedBy: new iam.CompositePrincipal(
      new iam.ServicePrincipal('codepipeline.amazonaws.com'),
      new iam.ArnPrincipal(pipelineRole.roleArn)
    ),
    description: 'Role for CodeStarConnections SourceAction'
  });

  const buildRole = new iam.Role(scope, 'CodeBuildActionRole', {
    roleName: mkRoleName('CodeBuildRole'),
    assumedBy: new iam.CompositePrincipal(
      new iam.ServicePrincipal('codepipeline.amazonaws.com'),
      new iam.ArnPrincipal(pipelineRole.roleArn)
    ),
    description: 'Role for CodeBuild Action via Pipeline'
  });

  const deployRole = new iam.Role(scope, 'CodeDeployActionRole', {
    roleName: mkRoleName('CodeDeployRole'),
    assumedBy: new iam.CompositePrincipal(
      new iam.ServicePrincipal('codepipeline.amazonaws.com'),
      new iam.ArnPrincipal(pipelineRole.roleArn)
    ),
    description: 'Role for CodeDeploy Server Deploy Action'
  });

  const projectExecutionRole = new iam.Role(scope, 'BuildProjectRole', {
    roleName: mkRoleName('BuildProjectRole'),
    assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    description: 'Execution role used directly by CodeBuild'
  });

  // Allow pipeline to assume each action role
  pipelineRole.addToPolicy(new iam.PolicyStatement({
    actions: ['sts:AssumeRole'],
    resources: [sourceRole, buildRole, deployRole, codedeployExecutionRole, projectExecutionRole].map(role => role.roleArn)
  }));

  sourceRole.addToPolicy(new iam.PolicyStatement({
    actions: ['codestar-connections:UseConnection'],
    resources: [connectionArn]
  }));

  buildRole.addToPolicy(new iam.PolicyStatement({
    actions: [
      's3:GetObject*', 's3:PutObject*', 's3:List*', 'logs:*', "codebuild:BatchGetBuilds",
      "codebuild:StartBuild",
      "codebuild:StopBuild",
      'lambda:UpdateFunctionCode', 'lambda:PublishVersion', 'lambda:GetFunction'
    ],
    resources: ['*', `arn:aws:codebuild:${region}:${account}:project/`]
  }));

  deployRole.addToPolicy(new iam.PolicyStatement({
    actions: [
      'codedeploy:RegisterApplicationRevision',
      'codedeploy:GetApplicationRevision',
      'codedeploy:CreateDeployment',
      'codedeploy:GetDeployment',
      'codedeploy:GetDeploymentConfig',
      'lambda:UpdateFunctionCode',
      'lambda:PublishVersion',
      'lambda:UpdateAlias',
      'lambda:GetFunction'
    ],
    resources: ['*']
  }));

  projectExecutionRole.addToPolicy(new iam.PolicyStatement({
    actions: [
      'logs:CreateLogGroup',
      'logs:CreateLogStream',
      'logs:PutLogEvents',
      's3:GetObject*',
      's3:PutObject*',
      's3:ListBucket',
      'codebuild:CreateReportGroup',
      'codebuild:CreateReport',
      'codebuild:UpdateReport',
      'codebuild:BatchPutTestCases',
      'codebuild:BatchPutCodeCoverages',
      'lambda:GetFunctionConfiguration', // Add this line
      'lambda:GetFunction',
      'lambda:GetAlias',
      'lambda:UpdateFunctionCode',
      'lambda:PublishVersion',
      'lambda:UpdateAlias',
      'lambda:UpdateFunctionConfiguration', // Add this line
    ],
    resources: ['*', `${myFunctionArnBase}:*`,
      `arn:aws:lambda:${region}:${account}:function:${functionName}`,
      `arn:aws:lambda:${region}:${account}:function:${functionName}:*`
    ]
  }));
  const lambdaPermissions = new iam.PolicyStatement({
    actions: [
      'lambda:GetFunction',
      'lambda:GetFunctionConfiguration',
      'lambda:UpdateFunctionCode',
      'lambda:PublishVersion',
      'lambda:GetAlias',
      'lambda:UpdateAlias'
    ],
    resources: [
      `arn:aws:lambda:${region}:${account}:function:${functionName}`,
      `arn:aws:lambda:${region}:${account}:function:${functionName}:*`
    ]
  });

  projectExecutionRole.addToPolicy(lambdaPermissions);

  return {pipelineRole, sourceRole, buildRole, deployRole, codedeployExecutionRole, projectExecutionRole};
}
