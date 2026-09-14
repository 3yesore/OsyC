# OsyC Coturn starter

This directory is reserved for an optional self-hosted Coturn Compose starter.
Keep it isolated from the OsyC API network, use credentials supplied through an
environment file, and expose only the TURN ports required by the deployment.
Do not commit passwords, shared secrets, certificates, or Vault data.

Before production use, add TLS certificates, rotate static credentials, apply
firewall restrictions, and review the upstream Coturn security guidance.
