# Demo OpenBao server (ADR-012): integrated storage on the `openbao-data` volume, so transit keys,
# the demo CA and KV secrets survive restarts, reboots and demo checkpoint restores.
#
# The static seal unseals on start with a key committed in the repo (demo-seal.key). That is for
# local development and the hackathon demo only; a real deployment uses an HSM or cloud KMS seal
# and never commits seal material.

storage "raft" {
  path    = "/openbao/file"
  node_id = "openbao"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true
}

seal "static" {
  current_key_id = "adili-demo-seal-1"
  current_key    = "file:///etc/openbao/demo-seal.key"
}

api_addr      = "http://127.0.0.1:8200"
cluster_addr  = "http://127.0.0.1:8201"
disable_mlock = true
