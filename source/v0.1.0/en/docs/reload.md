---
title: Reload
---

# POST /api/v1/operations/reload

> Draft endpoint. Reload is capability-gated and asynchronous. Queueing a
> reload is not proof that a new generation was validated and published.

Starts a configuration reload operation.

## Request

{% api_example startReload request empty http %}

## Response

### Accepted (202 Accepted)

{% api_example startReload 202 queued http %}

Poll [`GET /api/v1/operations/{id}`](operations.html) for completion.

### Completed result

{% api_example getOperation 200 reload_complete %}

The [operation envelope](operations.html) reports completion and failure. A
successful reload result contains nullable `active_generation_id` and
`datapath_generation_id`. These identify the active runtime and published
datapath policy; they need not be equal when the engine reuses an unchanged policy.

`succeeded` means the configuration was accepted and the required runtime and
datapath state is active. Reload may reuse an unchanged policy, and an unchanged
configuration need not advance the generation. On failure, the previous active
generation remains active.

## Example

```bash
curl -X POST http://localhost:9527/api/v1/operations/reload \
  -H 'Content-Type: application/json' \
  -d '{}'
```
