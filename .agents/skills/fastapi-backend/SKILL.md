---
name: fastapi-backend
description: Develop Lerne TMA FastAPI routes and Python services while preserving API contracts, authorization, and safe synchronous or asynchronous execution.
---

# FastAPI backend for Lerne TMA

## Contracts and permissions

Inspect `api/main.py`, affected `api/routers/` and `api/services/` modules, and consumers in `app/src/services/` and store actions. Check request and response shapes, errors, defaults, and authentication dependencies.

- Preserve contracts used by existing clients. Making a parameter optional is safe only when omission has defined behavior.
- Use validation models and explicit errors where they clarify the touched contract; avoid unrelated route rewrites.
- Enforce ownership and collaborative permissions for affected objects on the server. Check unauthorized and cross-user access when changing shared resources or permissions.
- Return expected domain failures through the existing error contract. Do not mask unexpected failures as successful empty responses or expose internal exceptions.

## Execution and side effects

- Peewee calls are synchronous; `async def` does not make them non-blocking. Choose a synchronous route or existing thread offloading pattern for blocking work; use async clients for awaited network I/O where appropriate.
- Keep a Peewee connection and its transaction in the same execution context. Do not split transactions across independent thread offloads or hold them open during external network calls.
- Inspect connection ownership in middleware and dependencies before adding scopes; ensure cleanup on failure.
- For multi-record mutations or migrations, read [data guidance](../db-mgmt/SKILL.md).
- Check whether timeouts or repeated requests can duplicate data or external work. Reuse existing idempotency mechanisms where applicable.
- Bound external requests with timeouts. Retry only safe operations and relevant transient failures. Inspect existing TTS and image caching before adding generation.
- Evaluate query counts for list endpoints. Use joins or prefetching for demonstrated N+1 patterns while preserving permissions and result semantics.

Use [verification guidance](../ai-harness-eval/SKILL.md), including relevant failure paths. Syntax checks do not validate contracts or authorization.
