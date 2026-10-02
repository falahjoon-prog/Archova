output "page_topic_arn" {
  value = aws_sns_topic.page.arn
}

output "ticket_topic_arn" {
  value = aws_sns_topic.ticket.arn
}
