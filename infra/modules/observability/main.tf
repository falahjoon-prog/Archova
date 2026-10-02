# CloudWatch alarms for the pages in infrastructure/05 §4 that infra can express today. SLO burn alerts, canaries
# and queue-age alerts arrive with the services that emit those metrics. Topics are wired to PagerDuty (or
# incident.io) by subscription once the tool is chosen.

data "aws_caller_identity" "current" {}

resource "aws_sns_topic" "page" {
  name              = "${var.name}-page"
  kms_master_key_id = var.kms_key_arn
  tags              = var.tags
}

resource "aws_sns_topic" "ticket" {
  name              = "${var.name}-ticket"
  kms_master_key_id = var.kms_key_arn
  tags              = var.tags
}

# --- api and web: 5xx > 2% for 5 min; p95 above 2x SLO for 10 min. These also roll deployments back. ---------

resource "aws_cloudwatch_metric_alarm" "http_5xx" {
  for_each            = var.http_services
  alarm_name          = "${each.value.alarm_prefix}-5xx-rate"
  alarm_description   = "${each.key}: more than 2% of requests returned 5xx for 5 minutes. Runbook: docs/infrastructure/08."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 2
  evaluation_periods  = 5
  datapoints_to_alarm = 5
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.page.arn]
  ok_actions          = [aws_sns_topic.page.arn]

  dynamic "metric_query" {
    for_each = each.value.target_groups
    content {
      id = "e${metric_query.key}"
      metric {
        namespace   = "AWS/ApplicationELB"
        metric_name = "HTTPCode_Target_5XX_Count"
        period      = 60
        stat        = "Sum"
        dimensions = {
          LoadBalancer = var.alb_arn_suffix
          TargetGroup  = metric_query.value
        }
      }
    }
  }

  dynamic "metric_query" {
    for_each = each.value.target_groups
    content {
      id = "r${metric_query.key}"
      metric {
        namespace   = "AWS/ApplicationELB"
        metric_name = "RequestCount"
        period      = 60
        stat        = "Sum"
        dimensions = {
          LoadBalancer = var.alb_arn_suffix
          TargetGroup  = metric_query.value
        }
      }
    }
  }

  metric_query {
    id          = "rate"
    label       = "5xx %"
    return_data = true
    expression = format(
      "100 * (%s) / MAX([1, %s])",
      join(" + ", [for i, _ in each.value.target_groups : "FILL(e${i}, 0)"]),
      join(" + ", [for i, _ in each.value.target_groups : "FILL(r${i}, 0)"]),
    )
  }

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "http_p95" {
  for_each            = var.http_services
  alarm_name          = "${each.value.alarm_prefix}-p95-latency"
  alarm_description   = "${each.key}: p95 target response time above 2x the SLO for 10 minutes (infrastructure/04 §2)."
  comparison_operator = "GreaterThanThreshold"
  threshold           = each.value.p95_threshold_seconds
  evaluation_periods  = 10
  datapoints_to_alarm = 10
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.page.arn]
  ok_actions          = [aws_sns_topic.page.arn]

  dynamic "metric_query" {
    for_each = each.value.target_groups
    content {
      id = "p${metric_query.key}"
      metric {
        namespace   = "AWS/ApplicationELB"
        metric_name = "TargetResponseTime"
        period      = 60
        stat        = "p95"
        dimensions = {
          LoadBalancer = var.alb_arn_suffix
          TargetGroup  = metric_query.value
        }
      }
    }
  }

  metric_query {
    id          = "worst"
    label       = "p95 (worst target group)"
    return_data = true
    expression  = "MAX([${join(", ", [for i, _ in each.value.target_groups : "FILL(p${i}, 0)"])}])"
  }

  tags = var.tags
}

# --- Database and queue ----------------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "aurora_cpu" {
  alarm_name          = "${var.name}-aurora-cpu"
  alarm_description   = "Aurora CPU above 90% for 10 minutes."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 10
  threshold           = 90
  comparison_operator = "GreaterThanThreshold"
  dimensions          = { DBClusterIdentifier = var.aurora_cluster_identifier }
  alarm_actions       = [aws_sns_topic.page.arn]
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "aurora_replica_lag" {
  alarm_name          = "${var.name}-aurora-replica-lag"
  alarm_description   = "Aurora replica lag above 30 s."
  namespace           = "AWS/RDS"
  metric_name         = "AuroraReplicaLagMaximum"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 30000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { DBClusterIdentifier = var.aurora_cluster_identifier }
  alarm_actions       = [aws_sns_topic.page.arn]
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "valkey_queue_memory" {
  alarm_name          = "${var.name}-valkey-queue-memory"
  alarm_description   = "Queue cluster memory above 85%. It is noeviction, so full means rejected jobs."
  namespace           = "AWS/ElastiCache"
  metric_name         = "DatabaseMemoryUsagePercentage"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  dimensions          = { ReplicationGroupId = var.valkey_queue_replication_group_id }
  alarm_actions       = [aws_sns_topic.page.arn]
  tags                = var.tags
}

# --- AI egress blocked (X25): any drop from the restricted subnets pages Jeff and Sam --------------------------

resource "aws_cloudwatch_metric_alarm" "restricted_egress_blocked" {
  count               = var.restricted_egress_metric == null ? 0 : 1 # no firewall in the demo
  alarm_name          = "${var.name}-restricted-egress-blocked"
  alarm_description   = "Network Firewall dropped egress from api or ai-worker to a host not on the allow-list. Check the alert log for the server name; an AI-looking host is a security incident (infrastructure/05 §4)."
  namespace           = var.restricted_egress_metric.namespace
  metric_name         = var.restricted_egress_metric.name
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.page.arn]
  tags                = var.tags
}

# --- Backup failures -------------------------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "backup_failed" {
  name        = "${var.name}-backup-failed"
  description = "AWS Backup or copy job failed"
  event_pattern = jsonencode({
    source      = ["aws.backup"]
    detail-type = ["Backup Job State Change", "Copy Job State Change"]
    detail      = { state = ["FAILED", "ABORTED"] }
  })
  tags = var.tags
}

resource "aws_cloudwatch_event_target" "backup_failed" {
  rule = aws_cloudwatch_event_rule.backup_failed.name
  arn  = aws_sns_topic.page.arn
}

data "aws_iam_policy_document" "page_topic" {
  statement {
    sid       = "CloudWatchAlarms"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.page.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "events.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "page" {
  arn    = aws_sns_topic.page.arn
  policy = data.aws_iam_policy_document.page_topic.json
}
