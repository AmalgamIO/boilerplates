mkdir -p codedeploy
cd dist && zip -r ../codedeploy/deployment-package.zip . && cd ..;

if [ -f package.json ]; then

  # Extract Lambda config from package.json
  LAMBDA_CONFIG=$(jq '.config.lambda // empty' package.json)

  # Check if .config.lambda exists and is non-null
  if [ -n "$LAMBDA_CONFIG" ]; then
    echo "Updating Lambda configuration..."
    jq --arg name "$FUNCTION_NAME" '. * { FunctionName: $name }' <<< "$LAMBDA_CONFIG" > lambda.config.json
    aws lambda update-function-configuration --cli-input-json file://lambda.config.json
    echo "Waiting for code update to propagate...";
    aws lambda wait function-updated --function-name "${FUNCTION_NAME}";
  else
    echo "No .config.lambda found in package.json. Nothing to update."
  fi
else
  echo "No package.json found. Breach in production flow. [ProtError - CRITICAL]."
fi
