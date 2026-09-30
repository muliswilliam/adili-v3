variable "subscription_id" {
  type        = string
  description = "Azure subscription that holds the credits. az account show --query id -o tsv"
}

variable "name_prefix" {
  type        = string
  description = "Prefix for every Azure resource (letters, numbers, hyphens)."
  default     = "adili-demo"
}

variable "location" {
  type        = string
  description = "Azure region. South Africa North is the closest public region to Kenya. This host is a demo, not the EACC production design (Konza / Nairobi)."
  default     = "southafricanorth"
}

variable "vm_size" {
  type        = string
  description = "Compose needs ~32 GiB RAM. Default E4s_v5 is 4 vCPU / 32 GiB and fits the common 4-core regional quota on credit subscriptions. D8s_v5 (8 vCPU / 32 GiB) needs a quota raise. D4s_v5 (16 GiB) will swap."
  default     = "Standard_E4s_v5"
}

variable "admin_username" {
  type    = string
  default = "adili"
}

variable "ssh_public_key" {
  type        = string
  description = "Contents of your SSH public key (e.g. ~/.ssh/id_ed25519.pub)."
}

variable "allowed_ssh_cidrs" {
  type        = list(string)
  description = "CIDRs allowed to SSH. Do not leave 0.0.0.0/0 on a long-lived box."
  default     = ["0.0.0.0/0"]
}

variable "dns_label" {
  type        = string
  description = "Public DNS label. Hostname becomes <label>.<region>.cloudapp.azure.com unless you attach a custom domain."
  default     = "adili-demo"
}

variable "letsencrypt_email" {
  type        = string
  description = "Email for Caddy's Let's Encrypt account on the public hostname."
  default     = ""
}

variable "custom_domain" {
  type        = string
  description = "Optional base domain you already control (e.g. adili-demo.example.com). Leave empty to use https://<dns_label>.<region>.cloudapp.azure.com with ports for console/verify/auth."
  default     = ""
}

variable "os_disk_gb" {
  type    = number
  default = 128
}
