# Primordial Lambda Function
A skeletal AWS Lambda function.
This project is a reference implementation for Lambda Functions intended for AWS Pipeline deployment.


### Configure _Build_
- See [buildspec.yml](./buildspec.yml)
- The build/bundle is expected under `dist/`.
- Files expected after `npm run build`: `files: ['dist/**/*', 'package-lock.json', 'buildspec.yml']`


### Configure Lambda
1. Edit [package.json](./package.json), `package.author.email` is **required**
   - If your function handler is not `index.handler` edit `package.config.lambda["Handler"]`
2. Edit [package.json](./package.json), fine-tune the lambda settings under  `.config.lambda` -  See [update manual](https://docs.aws.amazon.com/cli/latest/reference/lambda/update-function-code.html)
   - Permissible properties for `package.config.lambda` can be found in the [template](./config.lambda-template.json)
   - Minimum memory size, 128MB
   - Description =~ `[\d\w\s\-\_]|[^\<\>\$]`
   - See list of [runtimes](#) _WIP_
   - etc ...


### Consider comprehensive test framework
`npm install -D @types/node ts-node @vitest/coverage-v8 @vitest/coverage-istanbul vitest c8`
`npm install -D @types/aws-lambda @aws-sdk/client-s3`
`npm install -S aws-sdk`


### As configured in `buildspec.yml`
`npm run build`
`npm run test`

