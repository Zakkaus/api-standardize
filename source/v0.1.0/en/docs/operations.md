---
title: Operations
---

# GET /api/v1/operations/{operation_id}

> Draft endpoint. Reload, suspend, resume, probes, asynchronous group updates,
> provider refreshes, and asynchronous node and provider writes use one
> operation envelope.

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
| kind | string | `probe`, `reload`, `suspend`, `resume`, `group_update`, `provider_refresh`, `geodata_update`, `node_create`, `node_delete`, `provider_create`, or `provider_delete`. |
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

A successful `node_create` or `provider_create` result is the created
[Node](node-latency.html) or [Provider](providers.html), carrying its ID. A
successful `node_delete` or `provider_delete` result is the `deleted` count the
synchronous `200` would have returned.

`error` uses the same `code`, `message`, and optional `details` object defined
by the [native error contract](errors.html). Raw engine errors, stack traces,
configuration fragments, credentials, and local paths must not be returned.

Completed operations remain queryable for up to the
`resources.operations.retention_seconds` value advertised by
`GET /api/v1/capabilities`. A backend with a bounded operation store may evict
its oldest completed operation early to admit a new one; it refuses a new
operation with `503 temporarily_unavailable` only when every slot holds an
unfinished one. Clients that need a result should read it once the operation
completes. Unknown, expired, or evicted IDs return `404 resource_not_found`.
Cancellation is not part of the current draft.

Operation status is visible to the principal that created it and to callers
with `control`; unknown, expired, or unauthorized IDs all return
`404 resource_not_found` to avoid leaking existence.

## Replay

Only the requests below accept `Idempotency-Key` and support replay. The key
is scoped to the running instance, caller, method, and path. Reusing it with a byte-identical body returns the original response: the
original `202` body unchanged (its `status` stays `queued` whatever the
operation's current status), or the original synchronous `200`. Reusing it with
a body that differs in any byte returns `409 idempotency_conflict`. The key of
an unfinished operation is never evicted; when the store holds only unfinished
operations, a new one is refused with `503 temporarily_unavailable`. A finished
key is retained for the advertised retention window from completion: from the
terminal state of an operation, or from the reply of a synchronous `200`.
Without a key, a retried request may start another operation.

| Request | Replay |
|-----------|--------|
| `POST /api/v1/operations/reload`, `/suspend`, `/resume` | Original `202` |
| `POST /api/v1/probes` | Original `202` |
| `POST /api/v1/providers/{provider_id}/refresh` | Original `202` |
| `POST /api/v1/geodata/update` | Original `202` |
| `POST /api/v1/config/sources`, `PUT /api/v1/config/sources/{source_id}` | Original `202` |
| `PATCH /api/v1/groups/{group_id}` | Original `200` or `202` |

Every other write, including `PATCH /api/v1/runtime/settings` and both
connection `DELETE` endpoints, has no replay semantics: each call is evaluated
against current state. After an uncertain result, read the resource back
before retrying.

A key outlives its operation's early eviction: a replay can return an operation
whose `GET` is already `404`. A server that advertises
`resources.operations.max_replay_keys` may evict finished keys beyond that
count before the window ends, oldest-finished first; replaying an evicted key
may start a new operation.

Operation idempotency is scoped to the running instance; it is not a durable
retry guarantee across process restart. A client with an uncertain result
must re-observe runtime state rather than replay a mutation blindly.

## Example

```bash
curl http://localhost:9527/api/v1/operations/op-01HZX4K8W7
```
