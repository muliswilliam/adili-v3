locals {
  prefix = var.name_prefix
  # Azure DNS: portal / console / verify / auth as hostnames under custom_domain,
  # or a single cloudapp host with path-style / port access documented in the README.
  use_custom_domain = var.custom_domain != ""
  public_base       = local.use_custom_domain ? var.custom_domain : "${var.dns_label}.${var.location}.cloudapp.azure.com"
  # Without a custom domain Azure gives one FQDN. Caddy terminates TLS on 443 and
  # on the published app ports (Let's Encrypt HTTP-01 on :80).
  portal_url   = local.use_custom_domain ? "https://portal.${var.custom_domain}" : "https://${local.public_base}"
  console_url  = local.use_custom_domain ? "https://console.${var.custom_domain}" : "https://${local.public_base}:3020"
  verify_url   = local.use_custom_domain ? "https://verify.${var.custom_domain}" : "https://${local.public_base}:3030"
  keycloak_url = local.use_custom_domain ? "https://auth.${var.custom_domain}" : "https://${local.public_base}:8080"
}

resource "azurerm_resource_group" "demo" {
  name     = "${local.prefix}-rg"
  location = var.location
  tags = {
    project = "adili-v3"
    role    = "hackathon-demo-host"
  }
}

resource "azurerm_container_registry" "demo" {
  name                = replace("${local.prefix}acr", "-", "")
  resource_group_name = azurerm_resource_group.demo.name
  location            = azurerm_resource_group.demo.location
  sku                 = "Basic"
  admin_enabled       = false
}

resource "azurerm_virtual_network" "demo" {
  name                = "${local.prefix}-vnet"
  location            = azurerm_resource_group.demo.location
  resource_group_name = azurerm_resource_group.demo.name
  address_space       = ["10.40.0.0/16"]
}

resource "azurerm_subnet" "vm" {
  name                 = "vm"
  resource_group_name  = azurerm_resource_group.demo.name
  virtual_network_name = azurerm_virtual_network.demo.name
  address_prefixes     = ["10.40.1.0/24"]
}

resource "azurerm_network_security_group" "demo" {
  name                = "${local.prefix}-nsg"
  location            = azurerm_resource_group.demo.location
  resource_group_name = azurerm_resource_group.demo.name

  security_rule {
    name                       = "ssh"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefixes    = var.allowed_ssh_cidrs
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "http"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "https"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  dynamic "security_rule" {
    for_each = local.use_custom_domain ? [] : [3010, 3020, 3030, 8080, 8333]
    content {
      name                       = "demo-${security_rule.value}"
      priority                   = 200 + index([3010, 3020, 3030, 8080, 8333], security_rule.value)
      direction                  = "Inbound"
      access                     = "Allow"
      protocol                   = "Tcp"
      source_port_range          = "*"
      destination_port_range     = tostring(security_rule.value)
      source_address_prefix      = "*"
      destination_address_prefix = "*"
    }
  }
}

resource "azurerm_public_ip" "demo" {
  name                = "${local.prefix}-pip"
  location            = azurerm_resource_group.demo.location
  resource_group_name = azurerm_resource_group.demo.name
  allocation_method   = "Static"
  sku                 = "Standard"
  domain_name_label   = var.dns_label
}

resource "azurerm_network_interface" "demo" {
  name                = "${local.prefix}-nic"
  location            = azurerm_resource_group.demo.location
  resource_group_name = azurerm_resource_group.demo.name

  ip_configuration {
    name                          = "primary"
    subnet_id                     = azurerm_subnet.vm.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.demo.id
  }
}

resource "azurerm_network_interface_security_group_association" "demo" {
  network_interface_id      = azurerm_network_interface.demo.id
  network_security_group_id = azurerm_network_security_group.demo.id
}

resource "azurerm_linux_virtual_machine" "demo" {
  name                = "${local.prefix}-vm"
  location            = azurerm_resource_group.demo.location
  resource_group_name = azurerm_resource_group.demo.name
  size                = var.vm_size
  admin_username      = var.admin_username
  network_interface_ids = [
    azurerm_network_interface.demo.id,
  ]
  identity {
    type = "SystemAssigned"
  }

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = var.os_disk_gb
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  custom_data = base64encode(templatefile("${path.module}/cloud-init.yml.tftpl", {
    admin_username    = var.admin_username
    portal_url        = local.portal_url
    console_url       = local.console_url
    verify_url        = local.verify_url
    keycloak_url      = local.keycloak_url
    public_base       = local.public_base
    use_custom_domain = local.use_custom_domain
    custom_domain     = var.custom_domain
    letsencrypt_email = var.letsencrypt_email
    acr_name          = azurerm_container_registry.demo.name
  }))

  lifecycle {
    ignore_changes = [custom_data]
  }
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.demo.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_linux_virtual_machine.demo.identity[0].principal_id
}
