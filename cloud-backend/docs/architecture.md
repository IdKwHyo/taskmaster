# Henry Cloud architecture

## Runtime topology

```mermaid
flowchart TB
    UI[Pastel earth-tone dashboard] --> API[Public Cloud Run API]
    Bot[Discord interface] --> API
    API --> DB[(Firestore)]
    API --> Queue[Cloud Tasks queue]
    Queue --> Worker[Private Cloud Run worker]
    Worker --> ADK[Google ADK planner]
    ADK --> Gemini[Gemini 3.5 Flash]
    Worker --> Engine[Bounded workflow engine]
    Engine --> DB
    Engine --> Actions[Calendar and Discord]
```

## Mission state machine

```mermaid
stateDiagram-v2
    [*] --> PLANNING
    PLANNING --> RUNNING: bounded plan saved
    RUNNING --> WAITING_EXTERNAL: attendee contacted
    WAITING_EXTERNAL --> RUNNING: reply event
    RUNNING --> WAITING_APPROVAL: side effect proposed
    RUNNING --> PAUSED: owner pauses
    PAUSED --> RUNNING: owner resumes
    WAITING_APPROVAL --> RUNNING: approved
    WAITING_APPROVAL --> CANCELLED: rejected
    RUNNING --> COMPLETED: action read back and verified
    RUNNING --> FAILED: retries exhausted
    RUNNING --> PAUSED_BUDGET: cost or call cap
```

## Ownership

| Component | Owns | Does not own |
|---|---|---|
| Google ADK + Gemini | Small structured mission plan | Durable state or retry policy |
| Workflow engine | Transitions, limits, approval rules | Provider-specific persistence |
| Firestore | Missions, events, approvals, versions | Execution scheduling |
| Cloud Tasks | At-least-once wakeups | Mission truth |
| Tool adapters | Idempotent external actions | Planning or policy |
| Dashboard / Discord | Outcome delegation and decisions | Background execution |
