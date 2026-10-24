---
name: terraform-security
description: Secure infrastructure-as-code rules for Terraform and OpenTofu. Use whenever writing, reviewing, or changing .tf / .tfvars files, Terraform modules, providers, backends, or IaC pipelines. Requires the latest Terraform/OpenTofu and provider versions with a committed lock file, terraform fmt/validate, tflint, checkov (and/or trivy config) passing, remote encrypted state, and no hardcoded secrets.
---

# Terraform Security

Applies equally to OpenTofu (`tofu` instead of `terraform`).

## Hard rules

1. **Latest versions.** Latest stable Terraform/OpenTofu, latest provider and
   module versions, looked up at the time of the change.
2. **Lock file committed.** `.terraform.lock.hcl` is in git, with hashes for
   every platform CI and developers use.
3. **Checks pass**: `terraform fmt -check`, `terraform validate`, `tflint`,
   `checkov` (or `trivy config`). No unexplained skips.
4. **Remote, encrypted, locked state.** Never local state for shared
   infrastructure, never state in git.
5. **No secrets in code.** No credentials, passwords, or keys in `.tf`,
   `.tfvars`, or defaults.
6. **Plan before apply.** Every change is reviewed as a plan; applies only
   from CI on a protected branch.

## 1. Versions

Look up the latest, don't assume:

```bash
# Terraform / OpenTofu
git ls-remote --tags https://github.com/hashicorp/terraform | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1
# Providers (registry, or the provider's GitHub tags)
curl -s https://registry.terraform.io/v1/providers/hashicorp/aws | jq -r .version
git ls-remote --tags https://github.com/hashicorp/terraform-provider-aws | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1
```

Pin in `versions.tf` (see `assets/versions.tf.example`):

```hcl
terraform {
  required_version = ">= 1.17.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.70"
    }
  }
}
```

- Root modules: pessimistic `~>` on the latest minor; the lock file pins exact.
- Reusable modules: a lower bound only (`>= 6.70`), so callers can upgrade.
- Modules from the registry or git: pin an exact version or `?ref=<tag/sha>`.
  Never an unpinned git source.
- Upgrade with `terraform init -upgrade`, then lock hashes for all platforms:
  ```bash
  terraform providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=linux_arm64
  ```
- Review the provider's changelog for major bumps and fix deprecations.

## 2. Checks

```bash
terraform fmt -check -recursive
terraform init -backend=false && terraform validate
tflint --init && tflint --recursive
checkov -d . --quiet --compact
trivy config --exit-code 1 --severity HIGH,CRITICAL .   # alternative/extra
```

- `.tflint.hcl` enables the cloud's ruleset (aws/azurerm/google) at its latest
  version; see `assets/tflint.hcl.example`.
- Fix findings in the resource. Skip only a proven false positive, on the
  resource, with the check ID and a reason:
  ```hcl
  resource "aws_s3_bucket" "logs" {
    # checkov:skip=CKV_AWS_144: cross-region replication not needed for access logs
  }
  ```
  Same for tflint (`# tflint-ignore: rule_name # reason`) and trivy
  (`# trivy:ignore:AVD-AWS-0089`). Never disable a check globally to get green.

## 3. State

- Remote backend with encryption and locking (S3 with `use_lockfile = true`
  and SSE-KMS, GCS, azurerm, or Terraform Cloud/HCP).
- The state bucket: versioning on, public access blocked, access limited to
  the CI role and a break-glass group.
- State holds secrets in plaintext: treat read access to it as access to
  every secret in it.
- `.gitignore`: `.terraform/`, `*.tfstate`, `*.tfstate.*`, `crash.log`,
  `*.tfvars` holding secrets, `override.tf`.

## 4. Secrets

- Read secrets at apply time from a secrets manager (data sources for AWS
  Secrets Manager / SSM, Vault, Azure Key Vault, GCP Secret Manager), or
  generate them (`random_password`) and store them there.
- Mark secret variables and outputs `sensitive = true`.
- Provider credentials come from the environment / OIDC, never `access_key`
  arguments.
- Run `gitleaks` in pre-commit and CI.

## 5. Secure resource defaults

Defaults to apply unless the user says otherwise (details and examples in
`references/secure-defaults.md`):

- Encryption at rest everywhere (KMS customer-managed keys for sensitive data);
  TLS 1.2+ in transit.
- No public access: storage buckets block public access; databases not
  publicly accessible; no `0.0.0.0/0` ingress except 80/443 on load balancers.
- IAM least privilege: no `*` actions or resources on write permissions,
  no inline admin policies, no long-lived user keys.
- Logging on: CloudTrail/audit logs, VPC flow logs, bucket access logs, LB logs.
- Backups and deletion protection on stateful resources.
- Tags for owner and environment on every resource (`default_tags`).
- IMDSv2 required on instances (`http_tokens = "required"`).

## 6. Workflow

- `terraform plan -out=tfplan` on every MR; post the plan summary in the MR.
- Scan the plan too: `terraform show -json tfplan > plan.json && checkov -f plan.json`.
- `apply` only the reviewed plan file, only from CI, only on the protected
  branch, with an approval gate for production.
- CI authenticates to the cloud with OIDC, using a role scoped to that
  workspace/environment.
- Watch for drift (scheduled `plan -detailed-exitcode`).

## 7. Pre-commit

```yaml
- repo: https://github.com/antonbabenko/pre-commit-terraform
  rev: v1.109.3          # `pre-commit autoupdate` for the latest
  hooks:
    - id: terraform_fmt
    - id: terraform_validate
    - id: terraform_tflint
    - id: terraform_checkov
      args: [--args=--quiet --compact]
```

## Checklist before reporting done

- [ ] Latest Terraform/OpenTofu, providers, and modules; `.terraform.lock.hcl` updated for all platforms
- [ ] `fmt`, `validate`, `tflint`, `checkov`/`trivy config` clean; skips have IDs and reasons
- [ ] Remote encrypted, locked state; nothing sensitive in git
- [ ] No hardcoded secrets; sensitive vars/outputs marked
- [ ] Secure defaults applied (encryption, no public access, least-privilege IAM, logging)
- [ ] Plan reviewed; apply only via CI
