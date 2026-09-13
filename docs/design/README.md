# OsyC Formal Design Documents

This directory is the integration boundary for OsyC product and construction design. Existing LiveSync design documents outside this directory remain authoritative for LiveSync core behaviour.

## Document lifecycle

1. An agent records an idea or proposed change in `docs/changes/`.
2. The integration agent reviews compatibility, mobile and desktop impact, data migration, and operational risk.
3. The integration agent merges the accepted proposal into a formal design or construction document here.
4. Implementation references the accepted document and records verification in its change record.

Do not rewrite a formal document directly while another agent is working on it. Add a proposal record and let the integration agent resolve it.

## Current OsyC design entry points

- `docs/plans/osyc-settings-account-ui-2026-09-11.md` covers the current settings and account UI work.
- `src/osyc/README.md` defines the source boundary between OsyC and LiveSync core.
- New cross-agent proposals should link to the closest existing document and identify whether they are design, construction, or release governance changes.
