import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codeDeploy from 'aws-cdk-lib/aws-codedeploy';

import {Construct} from 'constructs';
import {Config, IConfig, ISettingParams} from "../config";
import {Utils} from "./utils";

type PTYPE = ILambdaUpdatePipelineParams & ISettingParams & { handlerConnectionArn: string; }

export class LambdaPipelineBruteStack extends cdk.Stack {
  public readonly config: Config;
  public readonly params: PTYPE;

  constructor(scope: Construct, id: string, protected props: ILambdaPipelineBruteStack) {
    super(scope, id, props);
    this.config = this.props.config.setStack<ILambdaUpdatePipelineParams>(this) as Config
    this.params = <PTYPE>this.config.params

    const {
      lambdaFunctionName,
      lambdaAliasName: aliasName = 'live',
      applicationName,
      memorySize = 128,
      buildTimeout = 20,
      buildSpecPath = undefined,
      initLambdaHandler = undefined,
      handlerRepoURL,
      handlerBranch,
      projectBucket: projectBucketName = `${lambdaFunctionName}Project`,
      handlerConnectionArn: connectionArn,
      // Internal vars
      /** suffix of name used in testAction CodeBuild */
      errorFileNameSuffix = 'test_results.json',
      /** name of folder on S3 where test reports are saved */
      objectKey = "Reports",
    } = this.params

    const buildCommands = buildSpecPath ?? 'buildspec.yml'

    /**
     * If `projectBucketName` is an ARN, **look up** `fromBucketArn`, otherwise create a new Bucket named ${projectBucketName}.
     * @type {s3.IBucket}.
     */
    const projectBucket = (Utils.isARN(projectBucketName))
      ? s3.Bucket.fromBucketArn(this, 'CodeBucket', projectBucketName)
      : new s3.Bucket(this, projectBucketName, {
        bucketName: projectBucketName,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        bucketKeyEnabled: true,
      });

    /**
     * Creates the roles - with associated resource permissions - required by the pipeline and Actions.
     */
    this.config.mkRoles({ connectionArn, bucketArn: projectBucket.bucketArn })

    const sourceOutput = new codepipeline.Artifact('SourceArtifact');
    const packageOutput = new codepipeline.Artifact('BuildArtifact');
    const compilerOutput = new codepipeline.Artifact('CompilerOutput');
    // const testOutput = new codepipeline.Artifact('TestOutput');

    const lambdaFunc = new lambda.Function(this, lambdaFunctionName, {
      code: this.getInitialHandler(projectBucket), // placeholder handler
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      functionName: lambdaFunctionName,
      description: "This is initial function.",
      memorySize: memorySize,
      timeout: cdk.Duration.seconds(buildTimeout),
      role: this.config.roles.lambdaExecutionRole,
    });

    /**
     * If `applicationName` is an ARN, **look up** `fromLambdaApplicationArn`, otherwise create a new LambdaApplication
     * named ${applicationName}.
     * @type {codeDeploy.ILambdaApplication}.
     */
    const application = Utils.isARN(applicationName)
      ? codeDeploy.LambdaApplication.fromLambdaApplicationArn(this,  applicationName, applicationName)
      : new codeDeploy.LambdaApplication(this,  applicationName, { applicationName });

    const alias = new lambda.Alias(this, 'LambdaAlias', {
      aliasName,
      version: lambdaFunc.currentVersion
    });

    // Add permissions for CodeDeploy to update the Lambda
    lambdaFunc.grantInvoke(new cdk.aws_iam.ServicePrincipal('codedeploy.amazonaws.com'));
    alias.grantInvoke(new cdk.aws_iam.ServicePrincipal('codedeploy.amazonaws.com'));

    // Create a CodeDeploy deployment group for Blue/Green or other deployment
    const deploymentGroup = this.mkLDGroup(application, alias)

    const owner_repo = Utils.parseGitHubRepoUrl(handlerRepoURL);

    const lambdaSourceAction = new codepipeline_actions.CodeStarConnectionsSourceAction({
      actionName: `GitHub-${lambdaFunctionName}`,
      triggerOnPush: true,
      connectionArn,
      ...owner_repo,
      branch: handlerBranch,
      output: sourceOutput,
      role: this.config.roles.sourceRole,
    });

    const compilerAction = new codepipeline_actions.CodeBuildAction({
      role: this.config.roles.buildRole,
      actionName: 'SourceCompiler',
      runOrder: 1,
      project: new codebuild.PipelineProject(this, 'LambdaCodeBuild', {
        role: this.config.roles.projectExecutionRole,
        projectName: `Compile-${this.params.lambdaFunctionName}`,
        environment: {
          buildImage: codebuild.LinuxLambdaBuildImage.AMAZON_LINUX_2023_NODE_20,
          computeType: codebuild.ComputeType.LAMBDA_2GB,
          privileged: false,
          // timeout: cdk.Duration.minutes(5),
          environmentVariables: {
            NODE_ENV: { value: 'development' }
          },
        },
        buildSpec: buildSpecPath ? codebuild.BuildSpec.fromSourceFilename(buildSpecPath) : undefined,
      }),
      input: sourceOutput, // From Source stage
      outputs: [compilerOutput], // Pass artifacts to next stage
    });

    const packageAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'ZipGenAppSpec',
      project:  new codebuild.PipelineProject(this, 'LambdaPackageProject', {
        role: this.config.roles.projectExecutionRole,
        projectName: `Update-${lambdaFunctionName}`,
        environment: {
          buildImage: codebuild.LinuxLambdaBuildImage.AMAZON_LINUX_2023_NODE_20,
          computeType: codebuild.ComputeType.LAMBDA_1GB,
          privileged: false, // Must be false for Lambda images
          environmentVariables: {
            NODE_ENV: { value: 'production' },
            FUNCTION_NAME: { value: lambdaFunctionName },
            ALIAS_NAME: { value: aliasName },
          },
        },
        buildSpec: codebuild.BuildSpec.fromObject(
          new Utils.BuildSpecBuilder()
          .phases.put('install').addCommand(Utils.getScripts('packageAction', 0)).end()
          .phases.put('build').addCommand(Utils.getScripts('packageAction', 1)).end()
          .artifact({ 'base-directory': 'codedeploy', files: ['deployment-package.zip', 'appspec.yml'], })
          .object()
        ),
      }),
      // Expects `compilerOutput`: artifact: { files: ['dist/**/*', 'package.json', 'package-lock.json'] }
      input: compilerOutput,
      outputs: [packageOutput],
      role: this.config.roles.buildRole,
    });

    const LOG_PASS_REPORTS = {
      /** Make `value.length > 0` to save reports from "passed" tests */
      value: ""
    }

    const testAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'RunTests',
      runOrder: 2,
      project: new codebuild.PipelineProject(this, 'TestProject', {
        role: this.config.roles.projectExecutionRole,
        projectName: `Test-${this.params.lambdaFunctionName}`,

        environment: {
          buildImage: codebuild.LinuxLambdaBuildImage.AMAZON_LINUX_2023_NODE_20,
          computeType: codebuild.ComputeType.LAMBDA_2GB,
          privileged: false,
          environmentVariables: {
            NODE_ENV: { value: 'test' },
            ERROR_BUCKET: { value: projectBucket.bucketName },
            TEST_REPORTS_DIR: { value: objectKey },
            LOG_PASS_REPORTS,
            PROJECT_NAME: { value: lambdaFunctionName },
            ERROR_FILE_NAME_SUFFIX: { value: errorFileNameSuffix },
            DEVOPS_EMAIL: {
              value: this.params.devopsEmail,
              type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
            },
          }
        },
        buildSpec: codebuild.BuildSpec.fromObject(new Utils.BuildSpecBuilder()
          .phases.put('install')
            .addCommand('mkdir ./ubin')
            .addCommand('curl -L https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 -o ./ubin/yq')
            .addCommand('sleep 1')
            .addCommand('chmod +x ./ubin/yq')
            .end()
          .phases.put('pre_build')
            .addCommand(`./ubin/yq -r '.phases.install.commands[]' '${buildCommands}' | while read -r cmd; do echo "+ $cmd"; CMD_STAT=$(eval "$cmd" 2>&1); echo "$CMD_STAT"; done;`)
            .end()
          .phases.put('build')
            .addCommand(Utils.getScripts('testAction', 0))
            .end()
          // .artifact({ 'base-directory': './', files: [`${objectKey}`] })
          .object()
        )
      }),
      input: sourceOutput,
      // outputs: [testOutput],
      outputs: [],
      role: this.config.roles.buildRole,
    });

    // const uploadAction = new codepipeline_actions.S3DeployAction({
    //   input: testOutput,
    //   bucket: projectBucket,
    //   actionName: "uploadAction",
    //   extract: true,
    //   // objectKey: objectKey,
    // })

    const deployAction = new codepipeline_actions.CodeDeployServerDeployAction({
      actionName: 'LambdaDGAppSpec',
      role: this.config.roles.codedeployExecutionRole,
      input: packageOutput,
      deploymentGroup
    });

    const pipeline = new codepipeline.Pipeline(this, `${this.params.pipelineName}`, {
      artifactBucket: projectBucket,
      pipelineName: `${this.params.pipelineName}`,
      pipelineType: codepipeline.PipelineType.V2,
      role: this.config.roles.pipelineRole
    });

    pipeline.addStage({ stageName: 'Source', actions: [lambdaSourceAction] });
    pipeline.addStage({ stageName: 'Compile', actions: [compilerAction] });
    pipeline.addStage({ stageName: 'Test', actions: [testAction] });
    pipeline.addStage({ stageName: 'Package', actions: [packageAction] });
    pipeline.addStage({ stageName: 'Deploy', actions: [deployAction] });
  }


  // Create a CodeDeploy deployment group for Blue/Green or other deployment
  private mkLDGroup = (application: codeDeploy.ILambdaApplication, alias: lambda.Alias) =>
    new codeDeploy.LambdaDeploymentGroup(this, this.params.deploymentGroupName,
      {
        application,
        alias,
        deploymentGroupName: this.params.deploymentGroupName,
        deploymentConfig: this.config.deploymentConfig,
        autoRollback: {failedDeployment: true},
        role: this.config.roles.codedeployExecutionRole,
      }
    );

  getInitialHandler(projectBucket: s3.IBucket): lambda.Code {
    const { initLambdaHandler } = this.params

    let lambdaCode: lambda.Code = lambda.Code.fromInline("exports.handler = async (event) => { return {statusCode: 200, body: JSON.stringify({ message: 'Placeholder code' })}; };");

    if (!!initLambdaHandler || initLambdaHandler.length < 12) {
      console.warn("ARN is null or too short")
    }
    else {
      const nameOrARN: string = initLambdaHandler
      if (Utils.isARN(nameOrARN)) {
        const {bucketName, objectKey} = Utils.parseS3Arn(nameOrARN)
        if (bucketName == projectBucket.bucketName) {
          lambdaCode = lambda.Code.fromBucket(projectBucket, objectKey);
        } else {
          const {baseArn, region, account_id, bucketName, objectKey} = Utils.parseS3Arn(nameOrARN)
          const anArn = [baseArn, region, account_id, bucketName].join(':')
          lambdaCode = lambda.Code.fromBucket(s3.Bucket.fromBucketArn(this, `${bucketName}_ID`, anArn), objectKey);
        }
      }
    }
    return lambdaCode;
  }

}

export type ILambdaUpdatePipelineParams = {
  initLambdaHandler: string;
  // notifierPath: string;
  // topicName: string;
}

export interface ILambdaPipelineBruteStack extends cdk.StackProps {
  config: IConfig;
}
