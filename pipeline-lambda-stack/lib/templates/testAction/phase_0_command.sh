

STATUS="No Test"
TEST_RESULTS='no tests'
TMP_FILE="tmp_results.json"
PROJECT_NAME=${PROJECT_NAME:-LambdaProj}

if [ -f package.json ]; then
  {
    npm test > "$TMP_FILE" && {
      STATUS="Passed";
      TEST_RESULTS=$(jq -Rs '@json' "$TMP_FILE");
    }
  } || { STATUS="Failed"; };
  COMMITTER_EMAIL=$(jq -r .author.email package.json 2>/dev/null || jq -r .author package.json 2>/dev/null);
else
  STATUS='No package.json';
fi

if [ "${STATUS}" == "Passed" ] && [ -z "$LOG_PASS_REPORTS" ]; then
  echo "STATUS: ${STATUS}";
  cat "$TMP_FILE"
  printf "\n";
  exit 0;
fi

if [ -n "$ERROR_BUCKET" ]; then
  DATETIME=$(date +'%Y%m%d%H%M%S')
  TEST_REPORTS_DIR=${TEST_REPORTS_DIR:-Reports}
  REPORT_DIR="${TEST_REPORTS_DIR}/${PROJECT_NAME}/${STATUS}"

  [ -z "$COMMITTER_EMAIL" ] && COMMITTER_EMAIL="${DEVOPS_EMAIL}"

  [ -z "$ERROR_FILE_NAME_SUFFIX" ] && ERROR_FILE_NAME_SUFFIX="test_results.json"

  mkdir -p "$REPORT_DIR" || { echo "Unable to create directory '${REPORT_DIR}'"; exit 50; }

  ERROR_FILE_NAME="${COMMITTER_EMAIL//[^a-zA-Z0-9-._\@]/_}_${DATETIME}-${ERROR_FILE_NAME_SUFFIX}"

  cat <<EOT > "${REPORT_DIR}/${ERROR_FILE_NAME}"
  {
   "datetime": "$DATETIME",
   "status": "${STATUS}",
   "committer": "${COMMITTER_EMAIL}",
   "details": "${TEST_RESULTS}"
  }
EOT

  aws s3 cp --recursive --exclude "*" --include "*${ERROR_FILE_NAME_SUFFIX}" "${TEST_REPORTS_DIR}/" "s3://${ERROR_BUCKET}/${TEST_REPORTS_DIR}/"
fi

sleep 2;

echo "STATUS: ${STATUS}";
cat "$TMP_FILE"
printf "\n"

if [ "${STATUS}" == "Failed" ]; then exit 43; fi