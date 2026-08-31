# Legacy migration boundary

The authoritative legacy source is `legacy/henry-play5.py`. Its hash is recorded in
`legacy/SHA256SUMS`; it is not imported by the Cloud Run image.

## Preserved

- Discord personality and owner/friend behavior
- Spotify playback controls
- Gmail send and briefing helpers
- Reminders, notes, goals, contact watches, and SQLite memory
- Browser and web-search tools
- Existing OAuth setup assets and local databases

## Ported for the hackathon mission

- Google Calendar availability checks
- Discord outbound attendee contact
- Calendar event creation after approval
- External reply ingestion through a shared backend API

The port changes the execution wrapper, not the user-visible capability. It replaces global
`PENDING_EVENT` state with a persisted approval record and stable action ID.

## Deferred

- Migrating every SQLite table to Firestore
- Hosted Spotify control
- Hosted browser/desktop automation
- General-purpose arbitrary tool DAGs
- WebSocket event streaming
- Multi-user OAuth onboarding

These items add failure modes without materially improving the four-minute Taskmaster demo.

