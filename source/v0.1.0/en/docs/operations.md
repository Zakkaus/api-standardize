---
title: Operations
---

# GET /api/v1/operations/{id}

> Draft endpoint. Reload, suspend, resume, probes, asynchronous group updates,
> and provider refreshes use one operation envelope.

An operation ID is opaque, unguessable, and unique for the lifetime of the
running adapter. Clients must not derive its kind or creation time from the ID.

## Accepted operation

Every `202 Accepted` response MUST include `Location` and `Retry-After`.
`Location` agrees with the envelope's `href`. `Retry-After` is a positive
integer number of seconds; clients MUST wait at least that long before the
next status poll. A running GET also includes it; a terminal GET need not.
An event can prompt a new GET, but does not waive the polling floor. Polling
too soon may return `429` with a fresh `Retry-After`.

{% api_example startReload 202 queued http %}

## Request

{% api_request getOperation %}

## Response

### Running (200 OK)

{% api_example getOperation 200 reload_running %}

### Completed (200 OK)

{% api_example getOperation 200 reload_complete %}

### Fields

| Field | Type | Description |
|-------|------|-------------|
| operation_id | string | Opaque operation identifier. |
| kind | string | `probe`, `reload`, `suspend`, `resume`, `group_update`, `provider_refresh`, or `geodata_update`. |
| status | string | `queued`, `running`, `succeeded`, or `failed`. |
| created_at | string | Creation timestamp (RFC3339). |
| started_at | string or null | Execution start timestamp. |
| finished_at | string or null | Terminal timestamp. |
| result | object or null | Required in every state; null until success, then the kind-specific result. |
| error | object or null | Safe machine-readable error after failure. |

A successful `group_update` result contains `group_id` and the applied
`config_revision`; fetch the group for its current full representation.
The operation's revision records that mutation's result even if another
update has already advanced the live resource.

A successful `provider_refresh` result is the refreshed
[Provider](providers.html). Refetch the provider and node list for current
state; the operation retains the result of that refresh.

A successful `geodata_update` result is the new [GeoData](geodata.html);
the datapath has already been reloaded with it.

`error` uses the same `code`, `message`, and optional `details` object defined
by the [native error contract](errors.html). Raw engine errors, stack traces,
configuration fragments, credentials, and local paths must not be returned.

Completed operations remain queryable for at least the
`resources.operations.retention_seconds` value advertised by
`GET /api/v1/capabilities`. Unknown or expired IDs return `404 resource_not_found`.
Cancellation is not part of the current draft.

Operation status is visible to the principal that created it and to callers
with `control`; unknown, expired, or unauthorized IDs all return
`404 resource_not_found` to avoid leaking existence.

Operation-start endpoints accept an optional `Idempotency-Key` header. During
the advertised operation retention window, the key is scoped to the caller,
method, and path. Reusing it with the same body returns the original operation;
reusing it with a different body returns `409 idempotency_conflict`. Without a
key, a retried POST may create another operation.

Operation idempotency is scoped to the running instance; it is not a durable
retry guarantee across process restart. A client with an uncertain result
must re-observe runtime state rather than replay a mutation blindly.

## Example

```bash
curl http://localhost:9527/api/v1/operations/op-01HZX4K8W7
```
