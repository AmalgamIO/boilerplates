import * as cdk from 'aws-cdk-lib'
import {Config} from "../config";
import {LambdaPipelineBruteStack} from "../lib/lambda-pipeline-brute";

const app = new cdk.App()
const config = new Config();

const pipeline_stack_name = [config.params.pipelineStackName]
  .filter(str => /\w+/.test(str))
  .pop();

if (!pipeline_stack_name) throw new Error("Set function name or pipelineStackName in parameters.json")

new LambdaPipelineBruteStack(
  app,
  pipeline_stack_name,
  {
    env: {...config.params.env },
    stackName: config.params.lambdaStackName,
    config,
    description: `Updates the '${config.params.pipelineName}' which deploys the Lambda function ${config.params.lambdaFunctionName}`,
  }
);
