# Backend verification

Verified on Python 3.12 with Google ADK 2.6.

```text
51 passed
866 statements: 866 covered
154 branches: 152 covered
Total coverage: 99%
Ruff: passed
Shell syntax: passed
Legacy SHA-256: passed
```

## Test boundaries

| Area | What is verified |
|---|---|
| Mission engine | Planning, every action kind, waits, resumes, approvals, rejection, completion |
| Reliability | Duplicate tasks/events, stable action IDs, retries, retry exhaustion, stale writes |
| Safety | Invalid plans, missing approval, conflicting decisions, impossible persisted states |
| Cost controls | Model-cost, model-call, tool-call, and workflow-step ceilings |
| API | Success path, validation, missing resources, error mapping, worker header protection |
| Google ADK | Runner/session construction, structured plan parsing, usage extraction, empty response |
| Firestore | CRUD, queries, transaction versioning, idempotent approval creation |
| Cloud Tasks | Queue path, body, task name, OIDC audience, immediate and delayed tasks |
| Calendar | Busy filtering, slot selection, event creation, duplicate-event recovery |
| Discord | Contact resolution, DM creation, nonce-enforced message delivery |
| Configuration | Origin parsing, validation, cache, local and production adapter selection |
| Legacy | Frozen file hash and the contracts ported into the Cloud slice |

All external systems are replaced with deterministic fakes. The suite performs no live Google,
Discord, OAuth, Firestore, Cloud Tasks, or network operations.

## Commands

```bash
ruff check henry_cloud tests
ruff format --check henry_cloud tests
coverage run -m pytest -q
coverage report
```

The configured coverage gate is 85%. This leaves room for generated/provider glue without
allowing future workflow logic to land effectively untested.

