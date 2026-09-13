# OsyC Privacy Policy

Effective: 2026-09-13

OsyC is an Obsidian client. It does not run a telemetry service and does not
send Vault content in the background.

## Data sent

When a user explicitly submits an AI task, the selected Markdown content and
the requested editing context are sent to the backend URL configured by that
user. Account activation sends the activation identifier and device metadata
needed to provision the account. Synchronization sends only the data required
by the selected LiveSync transport.

## Data retained

The configured service may retain task identifiers, status, usage accounting,
and redacted audit records for reliability, abuse prevention, and support. The
service operator must define the exact retention period in its deployment
policy and provide deletion on request. The plugin itself stores configuration
in Obsidian's plugin data area and does not upload it to this repository.

## Choices and deletion

Users can disable AI requests, synchronization, and active-note context in the
plugin settings. To request deletion of account, task, or synchronization data,
contact the operator of the configured backend using the support channel shown
in that service's account settings.

## Third parties

The plugin does not include advertising, client analytics, or an automatic
update channel. A backend operator may use a model provider to process an AI
task; that processing is governed by the operator's service terms.
