# Secure resource defaults (AWS examples)

The same principles apply on Azure and GCP: encrypt, keep private, least
privilege, log, protect stateful data.

## S3 bucket

```hcl
resource "aws_s3_bucket" "data" {
  # Skips are per-resource, with an ID and a reason. Remove them if the
  # bucket needs replication or event-driven processing.
  # checkov:skip=CKV_AWS_144: single-region data; backups cover recovery
  # checkov:skip=CKV2_AWS_62: no consumers need object events
  bucket = "example-data"
}

resource "aws_s3_bucket_logging" "data" {
  bucket        = aws_s3_bucket.data.id
  target_bucket = var.access_log_bucket
  target_prefix = "s3/example-data/"
}

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_ownership_controls" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Deny non-TLS access
data "aws_iam_policy_document" "tls_only" {
  statement {
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.data.arn, "${aws_s3_bucket.data.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "data" {
  bucket = aws_s3_bucket.data.id
  policy = data.aws_iam_policy_document.tls_only.json
}
```

## KMS

```hcl
data "aws_caller_identity" "current" {}

resource "aws_kms_key" "data" {
  description             = "data bucket"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms_data.json
}

# Account root administers the key; only the app role may use it.
data "aws_iam_policy_document" "kms_data" {
  # Key policies must use resources = ["*"], which means "this key";
  # checkov's IAM wildcard checks don't apply here.
  # checkov:skip=CKV_AWS_109: key policy, "*" is this key
  # checkov:skip=CKV_AWS_111: key policy, "*" is this key
  # checkov:skip=CKV_AWS_356: key policy, "*" is this key
  statement {
    sid       = "AccountAdmin"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
  statement {
    sid       = "AppUse"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [var.app_role_arn]
    }
  }
}
```

## Security groups

```hcl
# Bad
ingress {
  from_port   = 22
  to_port     = 22
  protocol    = "tcp"
  cidr_blocks = ["0.0.0.0/0"]
}

# Good: no SSH from the internet; use SSM Session Manager.
# Allow app traffic only from the load balancer's security group.
resource "aws_vpc_security_group_ingress_rule" "app_from_lb" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.lb.id
  from_port                    = 8080
  to_port                      = 8080
  ip_protocol                  = "tcp"
}
```

## IAM

```hcl
# Bad
actions   = ["*"]
resources = ["*"]

# Good: specific actions on specific resources
data "aws_iam_policy_document" "app" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.data.arn}/*"]
  }
}
```

No `aws_iam_access_key` for humans or CI; use SSO and OIDC roles.

## RDS

```hcl
resource "aws_db_instance" "main" {
  # ...
  storage_encrypted                   = true
  kms_key_id                          = aws_kms_key.data.arn
  publicly_accessible                 = false
  deletion_protection                 = true
  backup_retention_period             = 14
  iam_database_authentication_enabled = true
  manage_master_user_password         = true   # password in Secrets Manager
  auto_minor_version_upgrade          = true
  performance_insights_enabled        = true
  performance_insights_kms_key_id     = aws_kms_key.data.arn
  enabled_cloudwatch_logs_exports     = ["postgresql"]
}
```

## EC2 / launch templates

```hcl
metadata_options {
  http_tokens   = "required"   # IMDSv2
  http_endpoint = "enabled"
}

root_block_device {
  encrypted = true
}
```

## Load balancers

```hcl
resource "aws_lb_listener" "https" {
  port            = 443
  protocol        = "HTTPS"
  ssl_policy      = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn = aws_acm_certificate.main.arn
  # ...
}
# Port 80 listener only redirects to 443.
```

Set `drop_invalid_header_fields = true` and enable access logs.

## Secrets

```hcl
# Bad
variable "db_password" {
  default = "hunter2"
}

# Good
variable "db_password" {
  type      = string
  sensitive = true
}

data "aws_secretsmanager_secret_version" "api" {
  secret_id = "app/api-key"
}
```
