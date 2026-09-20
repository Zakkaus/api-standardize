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

{% api_example getOperation 200 reload_complete_reload %}

### Fields

| Field | Type | Description |
|-------|------|-------------|
| operation_id | string | Reload operation identifier. |
| status | string | `queued`, `running`, `succeeded`, or `failed`. |
| result.active_generation_id | string or null | Generation active after completion. |
| result.datapath_generation_id | string or null | Generation published to the datapath. |
| finished_at | string or null | Completion timestamp (RFC3339). |
| error | object or null | Shared safe error object, when present. |

An operation may report `succeeded` only after configuration validation,
datapath routing publication, and active-generation promotion all complete.
When reload fails, the previous active generation remains active.

## Example

```bash
curl -X POST http://localhost:9527/api/v1/operations/reload \
  -H 'Content-Type: application/json' \
  -d '{}'
```
