import {Arn, ArnComponents, ArnFormat} from "aws-cdk-lib";
import * as fs from 'fs';
import * as path from 'path';

/**
 * Extract project owner and repository name from URL
 *
 * @param url The full URL ending with `.git`
 * @return {{ owner: string; repo: string }} A Map of owner and repository
 */
export function parseGitHubRepoUrl(url: string): { owner: string; repo: string } {
  if (!url) throw new TypeError(`Blank/NULL URL -> '${url}'`)
  const regex = /^https:\/\/(?:www\.)?github\.com\/([^\/]+)\/([^\.]+)(?:\.git)?$/
  const match = url.trim().match(regex)
  if (!match) throw new TypeError(`Bad URL -> '${url}'`)
  return { owner: match[1], repo: match[2] }
}

/**
 * True if string is ARN-like
 * @param str
 * @return boolean
 */
export function isARN(str: string): boolean {
  return !!str && /^arn:(aws|aws-us-gov):[a-z0-9-]+:.+/.test(str);
}

/**
 *  const arn = 'arn:aws:aws:ec2:us-west-2:123456789012/i-0abcdef1234567890';
 *  arn:aws:iam::{{ACCOUNT}}:role/MyLambdaBasicExecutionRole"
 * @param {string} arn
 */
export function parseArn(arn: string): ArnComponents {
  const type = arnType(arn);
  if (!type) {
    throw new Error('Invalid ARN format');
  }
  return Arn.split(arn, type);
}

/**
 * arn:aws:iam::{{ACCOUNT}}:role/MyLambdaBasicExecutionRole
 * arn:aws:s3:::mi-pipeline-lambda-code
 * arn:aws:codedeploy:{{REGION}}:{{ACCOUNT}}:application:Neopolitan
 * arn:aws:sns:us-west-2:009072398085:VanillaStack-TestFailureTopicA800E84D-4cnnQSW8yoaX
 */
export function arnType(arn: string): ArnFormat | undefined {
  const arnRegex = /arn:(?<partition>aws|aws-us-gov):(?<service>[a-z0-9-]+):.+/;
  const match = arn.match(arnRegex);

  if (!match?.groups?.service) {
    return undefined;
  }

  const frmt: Record<string, ArnFormat> = {
    s3: ArnFormat.NO_RESOURCE_NAME,
    iam: ArnFormat.COLON_RESOURCE_NAME,
    codedeploy: ArnFormat.NO_RESOURCE_NAME,
    role: ArnFormat.SLASH_RESOURCE_NAME,
    sns: ArnFormat.COLON_RESOURCE_NAME,
  };

  return frmt[match.groups.service];
}

  // const arnRegex = /arn:(?<partition>aws|aws-us-gov):(?<service>[a-z0-9-]+):(?<region>[a-z0-9-]+):(?<account>[^/]+)\/(?<resource>.+)/;
  // const match = arn.match(arnRegex);
  // if (match && match.groups) throw new TypeError("NAA-Error. String is Not An ARN")
  // return match.groups as ArnComponents

/**
 * Sanitizes a user-provided string into a valid AWS IAM role name.
 * IAM role names must only contain a-z, A-Z, 0-9, and +=,.@_-
 * and must be no longer than 64 characters.
 *
 * @param input Raw user input string.
 * @returns A sanitized string safe for use as an IAM Role name.
 */
export function sanitizeIamRoleName(input: string): string {
  const allowedPattern = /[^a-zA-Z0-9+=,.@_-]/g;
  const cleaned = input.replace(allowedPattern, '');
  return cleaned.slice(0, 64);
}


export function parseS3Arn(arn: string): { baseArn: string; region: string; account_id: string; bucketName: string; objectKey: string } {
  const s3ArnPattern = /^(arn:aws:s3):([a-z0-9-]*):([a-z0-9-]*):([^/]+)\/(.+)$/;
  const match = arn.match(s3ArnPattern);

  if (!match) {
    throw new Error(`Invalid S3 ARN: ${arn}`);
  }

  const [baseArn, region, account_id, bucketName, objectKey] = match;
  return { baseArn, region, account_id, bucketName, objectKey };
}

export const isNotBlank = (str?: string): boolean => str != null && /.+/.test(str)

export function renderScript(script: string, values: { [varname: string]: string }) {
  return script.replace(/\{\{([^}]+)\}\}/g, (match, p1) => values[p1.trim()] || match);
}


export class BuildSpecBuilder {
  private spec: any;

  constructor() {
    this.spec = {
      version: '0.2',
      phases: {},
      artifacts: {},
    };
  }

  public phases = {

    put: (phase: string) => {
      const parent = this
      if (!this.spec.phases[phase]) {
        this.spec.phases[phase] = { commands: [] };
      }
      return {
        addCommand: (cmd: string) => {
          parent.spec.phases[phase].commands.push(cmd);
          return parent.phases.put(phase); // Continue chaining on same phase
        },
        end() {
          return parent
        },

      };
    },
  };

  public artifact(config: { [key: string]: any }) {
    this.spec.artifacts = config;
    return this; // allow chaining
  }

  public object() {
    return this.spec;
  }
}




export function getScripts(action: string, phaseIndex: number): string {
  const filePath = path.join(__dirname, '..', 'templates', action, `phase_${phaseIndex}_command.sh`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Script not found: '${filePath}'`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}
