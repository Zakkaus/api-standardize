---
title: Suspend
---

# POST /api/v1/operations/suspend

> Draft endpoint. Suspension is capability-gated and asynchronous. It is not
> a universal dae/honk operation.

Starts suspension for an adapter that implements a no-load lifecycle.

## Request

{% api_example startSuspend request empty http %}

## Response

### Accepted (202 Accepted)

{% api_example startSuspend 202 queued http %}

Poll [`GET /api/v1/operations/{id}`](operations.html) for completion.

### Completed result

{% api_example getOperation 200 suspend_complete %}

### Fields

| Field | Type | Description |
|-------|------|-------------|
| operation_id | string | Suspension operation identifier. |
| status | string | `queued`, `running`, `succeeded`, or `failed`. |
| result.runtime_state | string or null | `suspended` after a successful operation. |
| finished_at | string or null | Completion timestamp (RFC3339). |
| error | object or null | Shared safe error object, when present. |

If the adapter advertises `resources.resume.available`, resume uses:

{% api_example startResume request empty http %}

Resume returns the same operation envelope with `kind: resume`. On success,
`result.runtime_state` is `running`, or null when the adapter cannot observe
the resulting state, consistent with suspension's nullable state field.
Acceptance alone must never be reported as successful resumption.

An unavailable suspend or resume operation returns `404 capability_not_supported`.
A lifecycle state that prevents the transition returns `409 state_conflict`.

## Example

```bash
curl -X POST http://localhost:9527/api/v1/operations/suspend \
  -H 'Content-Type: application/json' \
  -d '{}'
```
