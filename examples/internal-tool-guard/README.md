# From AI-coded prototype to an internal tool I would trust

AI-assisted application work sample for Appier's **IT Developer** role, prepared 1 November 2026.

## Why this experiment

[Appier's IT Developer posting](https://job-boards.greenhouse.io/appier/jobs/8238768) describes colleagues building their own internal tools with AI, and IT helping with permissions, errors, deployment and maintainability. I focused on the boundary between an AI-proposed API call and a business side effect.

I also read Appier's [article about joint tool creation and use](https://www.appier.com/en/press-media/joint-optimization-of-tool-creation-and-use-for-llm) and the [paper abstract](https://arxiv.org/abs/2608.24571). The useful connection for this role is checking tool contracts and actual execution outcomes separately. This experiment is an engineering analogy; it does **not** reproduce SMITH, reinforcement learning, its models or its reported results.

## The narrow workflow

A colleague's AI-generated script proposes a Slack-style notification. The server validates its shape and checks a trusted actor's channel-specific scope. A separate approval record must match the actor, tenant, request ID and exact payload. A SQLite request ledger survives a worker restart. Retries use a stable provider key, and completion requires read-back evidence. Audit events omit message bodies.

The integration is **fake**. It makes no network calls and needs no credentials, model account or paid service. `approve()` represents an authenticated approval service; this module is not an HTTP service.

## Reproduce

Python 3.10+; standard library only. From this folder:

```bash
python3 -m unittest -v
python3 guard.py
```

`results.json` is the output of the second command. Seven test methods cover eight deterministic fault scenarios plus tenant/actor isolation, changed payloads, request-bound approval, invalid inputs, restart behavior and failed verification.

## Observed results

The baseline is a deliberately minimal send-and-retry script, **not an LLM benchmark or a comparison with Appier's systems**. Both versions use the same fake provider. Counts below are stored side effects per scenario, not success percentages.

| Injected scenario | Baseline writes | Guarded writes | Guarded outcome |
|---|---:|---:|---|
| Normal approved request | 1 | 1 | Completed with read-back |
| Extra model-generated approval field | 1 | 0 | Schema rejected |
| Missing channel permission | 1 | 0 | Permission denied |
| No human approval record | 1 | 0 | Waiting for approval |
| Duplicate delivery of same request | 2 | 1 | Cached completion |
| Response lost after provider committed | 2 | 1 | Retry with same provider key |
| Message changed after approval | 1 | 0 | Requires fresh approval |
| Provider unavailable | 0 | 0 | Two attempts, then unknown; reconciliation required |

The main finding is about failure semantics: an unavailable provider must not become a false success, and an ambiguous timeout must not automatically create another business action.

## Limits and the next production step

The fake provider supports idempotent writes and read-back. Real Slack/API behavior must be verified before claiming duplicate suppression; a local ledger alone cannot close the crash-after-write window. SQLite is a local demonstrator, not a tested multi-instance Cloud Run data store. Approvals have no expiry or revocation here. The suite is fixed and small; there is no model evaluation, load test, deployment or proof against every prompt-injection attack.

For a real pilot, I would first agree on one low-risk workflow with its owner, verify provider reconciliation/idempotency behavior, then use authenticated identity, a transactional shared store, approval expiry, least-privilege secrets, bounded retry/backoff and operational monitoring. I would keep ambiguous outcomes visible for human reconciliation.

## Existing portfolio connection

[Henry](https://github.com/IdKwHyo/taskmaster) contains the larger workflow state machine and Cloud Run/Firestore/Cloud Tasks project configuration. This standalone experiment can be reviewed without bringing up that stack. It does not change Henry's running code.

Prepared with AI coding assistance. The important review discussion is the trust boundary, the retry assumptions and the limits above.
