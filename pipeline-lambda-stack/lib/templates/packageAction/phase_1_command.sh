NEW_VERSION=$(aws lambda publish-version --function-name "${FUNCTION_NAME}" --query Version --output text)
CURRENT_VERSION=$(aws lambda get-alias --function-name "${FUNCTION_NAME}" --name "${ALIAS_NAME}" --query FunctionVersion --output text)

cat <<EOT > codedeploy/appspec.yml
version: 0.0
Resources:
  - ${FUNCTION_NAME}:
      Type: AWS::Lambda::Function
      Properties:
        Name: ${FUNCTION_NAME}
        Alias: ${ALIAS_NAME}
        CurrentVersion: ${CURRENT_VERSION}
        TargetVersion: ${NEW_VERSION}
EOT
