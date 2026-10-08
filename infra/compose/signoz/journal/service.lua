-- Turbo prefixes each app line with @adili/<service>:task:. SigNoz filters logs on the
-- resource attribute service.name. Fluent Bit's OpenTelemetry output copies that
-- attribute from record.resource.attributes on records that are not already an
-- OpenTelemetry group.

function set_service(tag, timestamp, record)
  local message = record["MESSAGE"] or ""
  local name = string.match(message, "@adili/([%w%-]+)")
  if name == nil then
    name = "adili-apps"
  end
  record["service.name"] = name
  record["service_name"] = name
  record["resource"] = {
    attributes = {
      ["service.name"] = name,
    },
  }
  local severity = string.match(message, "%] ([A-Z]+) ")
  if severity ~= nil then
    record["severity_text"] = severity
  end
  return 1, timestamp, record
end
