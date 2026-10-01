output "resource_group" {
  value = azurerm_resource_group.demo.name
}

output "public_ip" {
  value = azurerm_public_ip.demo.ip_address
}

output "fqdn" {
  value = azurerm_public_ip.demo.fqdn
}

output "ssh" {
  value = "ssh ${var.admin_username}@${azurerm_public_ip.demo.fqdn}"
}

output "acr_login_server" {
  value = azurerm_container_registry.demo.login_server
}

output "urls" {
  value = {
    portal   = local.portal_url
    console  = local.console_url
    verify   = local.verify_url
    keycloak = local.keycloak_url
  }
}

output "next_steps" {
  value = <<-EOT
    1. ssh ${var.admin_username}@${azurerm_public_ip.demo.fqdn}
    2. Clone or rsync adili-v3 to /opt/adili
    3. sudo /opt/adili/infra/azure/bootstrap-stack.sh
    Keycloak stays the identity provider (same image and realm as local). Do not point the apps at Entra ID.
  EOT
}
