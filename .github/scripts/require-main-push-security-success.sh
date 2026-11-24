#!/usr/bin/env bash
set -euo pipefail

: "${EXPECTED_COMMIT:?EXPECTED_COMMIT must identify the commit being deployed}"
: "${GH_TOKEN:?GH_TOKEN must be a read-only Actions API token}"
: "${GITHUB_API_URL:?GITHUB_API_URL is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

api_url="${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/workflows/security.yml/runs?head_sha=${EXPECTED_COMMIT}&per_page=20"

for attempt in $(seq 1 90); do
  runs="$(curl --fail --silent --show-error \
    --retry 2 --retry-delay 2 \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "${api_url}")"

  security_run="$(jq -c --arg sha "${EXPECTED_COMMIT}" --arg repository "${GITHUB_REPOSITORY}" '
    [
      .workflow_runs[]?
      | select(
          .head_sha == $sha and
          .head_branch == "main" and
          .head_repository.full_name == $repository and
          .event == "push"
        )
    ]
    | sort_by(.run_started_at // .created_at)
    | last // empty
  ' <<< "${runs}")"

  if [[ -n "${security_run}" ]]; then
    run_id="$(jq -r '.id' <<< "${security_run}")"
    run_status="$(jq -r '.status' <<< "${security_run}")"
    run_conclusion="$(jq -r '.conclusion // empty' <<< "${security_run}")"

    if [[ "${run_status}" == "completed" ]]; then
      if [[ "${run_conclusion}" != "success" ]]; then
        echo "::error::Security workflow for main commit ${EXPECTED_COMMIT} finished with conclusion '${run_conclusion}'. Deployment is blocked."
        exit 1
      fi

      echo "security_run_id=${run_id}" >> "${GITHUB_OUTPUT}"
      {
        echo "## Exact-commit security deployment gate"
        echo
        echo "- Commit: ${EXPECTED_COMMIT}"
        echo "- Security workflow run: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${run_id}"
        echo "- Conclusion: success"
      } >> "${GITHUB_STEP_SUMMARY}"
      exit 0
    fi
  fi

  echo "Waiting for the same-commit main security workflow to finish (attempt ${attempt}/90)."
  sleep 10
done

echo "::error::No successful Security & Workflow Validation push run was observed for main commit ${EXPECTED_COMMIT} within 15 minutes. Deployment is blocked."
exit 1
