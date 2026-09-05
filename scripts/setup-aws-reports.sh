#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# One-time AWS bootstrap for CI report publishing.
#
# Creates:
#   1. An S3 bucket with static-website hosting + public read (reports only)
#   2. The GitHub OIDC identity provider (skipped if it already exists)
#   3. An IAM role GitHub Actions can assume, scoped to one repo, with
#      write access to the report bucket only
#
# Requires: aws CLI v2, credentials with IAM + S3 admin rights.
#
# Usage:
#   ./scripts/setup-aws-reports.sh <bucket-name> <aws-region> <github-org/repo>
# Example:
#   ./scripts/setup-aws-reports.sh standardbank-suite-reports eu-west-1 Miss-Kay/standardbank-web-framework
# ---------------------------------------------------------------------------

BUCKET=${1:?usage: setup-aws-reports.sh <bucket-name> <aws-region> <github-org/repo>}
REGION=${2:?usage: setup-aws-reports.sh <bucket-name> <aws-region> <github-org/repo>}
REPO=${3:?usage: setup-aws-reports.sh <bucket-name> <aws-region> <github-org/repo>}
# Derive the role name from the repo so two projects in the same AWS account
# never share one role. They used to: a shared "playwright-report-publisher"
# meant running this script for a second repo silently repointed the first
# repo's trust policy and bucket grant at the new project, breaking its CI.
ROLE_NAME=${ROLE_NAME:-$(basename "$REPO")-report-publisher}

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account: $ACCOUNT_ID | Bucket: $BUCKET | Region: $REGION | Repo: $REPO"

# --- 1. Report bucket with static website hosting --------------------------
if [ "$REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"
fi

aws s3 website "s3://$BUCKET" --index-document index.html

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false

aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadReports",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$BUCKET/*"
  }]
}
JSON
)"

# --- 2. GitHub OIDC identity provider (idempotent) --------------------------
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com >/dev/null 2>&1 \
  && echo "OIDC provider created" \
  || echo "OIDC provider already exists — skipping"

# --- 3. IAM role assumable only by Actions runs of this repo ----------------
# GitHub can issue OIDC tokens with an "immutable" subject that embeds the
# numeric owner and repo IDs:
#   repo:owner@86423962/repo@1358460147:ref:refs/heads/main
# instead of the classic:
#   repo:owner/repo:ref:refs/heads/main
# The setting is account-wide and can be switched on after a role is created,
# which silently breaks every trust policy that only matches the classic form
# — the failure is an opaque "Not authorized to perform
# sts:AssumeRoleWithWebIdentity". We trust BOTH forms so either setting works.
SUBS="\"repo:$REPO:*\""
if command -v gh >/dev/null 2>&1; then
  REPO_ID=$(gh api "repos/$REPO" --jq .id 2>/dev/null || echo "")
  OWNER_ID=$(gh api "repos/$REPO" --jq .owner.id 2>/dev/null || echo "")
  if [ -n "$REPO_ID" ] && [ -n "$OWNER_ID" ]; then
    OWNER=${REPO%%/*}
    NAME=${REPO##*/}
    SUBS="$SUBS, \"repo:$OWNER@$OWNER_ID/$NAME@$REPO_ID:*\""
    echo "Trusting both classic and immutable OIDC subjects for $REPO"
  else
    echo "WARNING: could not read numeric IDs for $REPO via gh." >&2
    echo "If the account uses immutable OIDC subject IDs, add that form manually." >&2
  fi
else
  echo "WARNING: gh not found — trusting only the classic OIDC subject form." >&2
fi

TRUST=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::$ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike":   { "token.actions.githubusercontent.com:sub": [ $SUBS ] }
    }
  }]
}
JSON
)

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  # Refuse to repoint a role that belongs to a different repository.
  EXISTING_SUB=$(aws iam get-role --role-name "$ROLE_NAME" \
    --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringLike."token.actions.githubusercontent.com:sub"' \
    --output text 2>/dev/null || echo "")
  if [ -n "$EXISTING_SUB" ] && [ "$EXISTING_SUB" != "None" ] && ! echo "$EXISTING_SUB" | grep -q "repo:$REPO:\*"; then
    echo "ERROR: role $ROLE_NAME is already trusted by $EXISTING_SUB, not repo:$REPO:*." >&2
    echo "Refusing to repoint it — that would break the other repo's CI." >&2
    echo "Re-run with a different name, e.g. ROLE_NAME=my-role $0 $BUCKET $REGION $REPO" >&2
    exit 1
  fi
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST"
  echo "Role $ROLE_NAME already existed for this repo — trust policy refreshed"
else
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST" >/dev/null
  echo "Role $ROLE_NAME created"
fi

aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name s3-report-sync \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::$BUCKET/reports/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::$BUCKET"
    }
  ]
}
JSON
)"

ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)

cat <<EOF

Done. Now wire GitHub to AWS (from the repo directory):

  gh secret set AWS_ROLE_ARN  --body "$ROLE_ARN"
  gh variable set AWS_REGION    --body "$REGION"
  gh variable set REPORT_BUCKET --body "$BUCKET"

Reports will publish to:
  http://$BUCKET.s3-website.$REGION.amazonaws.com/reports/<run-number>/index.html
EOF
