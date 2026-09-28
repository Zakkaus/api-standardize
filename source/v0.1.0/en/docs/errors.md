---
title: Errors
---

# Error responses

All native API errors use one JSON envelope:

{% api_example patchGroup 412 stale_revision %}

| Field | Type | Description |
|-------|------|-------------|
| error.code | string | Stable machine-readable code. |
| error.message | string | Short safe description for an operator. |
| error.details | object or null | Optional structured details; never raw engine output. |
| request_id | string or null | Identifier for correlating server-side logs. |

## Shared status semantics

The `ErrorCode` schema in the OpenAPI document enumerates exactly the codes below
for HTTP error bodies (`ApiError`); adding one is a contract change. Errors embedded
in resources (`operation.error`, `datapath.errors`, `last_reload.error`,
`provider.last_error`) carry an adapter-defined code, except the shared codes
for a failed configuration change listed under
[activation outcomes](#Activation-outcomes).

| Status | Typical code | Meaning |
|--------|--------------|---------|
| 400 | `invalid_request` | Malformed parameter or request shape. |
| 401 | `authentication_required` | Credentials are missing or invalid. |
| 401 | `invalid_credentials` | Username or password is incorrect during password login. |
| 403 | `permission_denied` | The caller lacks the required permission, or listener security policy rejects the request. |
| 404 | `resource_not_found` | The requested resource does not exist. |
| 404 | `capability_not_supported` | The running adapter does not expose the resource or action. |
| 409 | `state_conflict` | The current state prevents the request: a name in use, a referenced object that is not current, or a transition the current state does not allow. |
| 409 | `idempotency_conflict` | An idempotency key was reused with a different request body. |
| 409 | `event_cursor_expired` | Event or log SSE cursor cannot be replayed; open a fresh stream and establish a new baseline. |
| 409 | `setup_required` | Password login was requested before an administrator was created. |
| 409 | `setup_already_completed` | Administrator setup was requested after an administrator was created. |
| 410 | `snapshot_expired` | A page cursor is no longer usable; restart the page walk. |
| 410 | `flow_expired` | Flow evidence was evicted/expired and a tombstone still exists. |
| 412 | `stale_revision` | `If-Match` does not match the current resource revision or stored source content hash, or the configuration changed while a delete was being admitted. |
| 413 | `request_too_large` | Request or requested fan-out exceeds an advertised limit. |
| 415 | `unsupported_media_type` | Request `Content-Type` is unsupported. |
| 422 | `unsupported_value` | The request is well-formed but the engine does not support its meaning, or full validation of a configuration candidate found error diagnostics. |
| 428 | `precondition_required` | A required `If-Match` header is missing. |
| 429 | `rate_limited` | A request-rate limit, or a limit on repeating the same work, was reached. |
| 503 | `temporarily_unavailable` | A shared capacity limit is full, such as a bounded queue or the stream subscriber slots, or a required runtime component is unavailable. |
| 503 | `snapshot_unavailable` | A coherent snapshot could not be pinned or held within its memory budget; retry the read. |

Any operation can return `400` or `413` before its handler runs: request
boundary checks (target and header length, `Content-Length`, body size) apply to
every request, and a `GET` with a body is malformed.

## Choosing the status

A server checks a request in this order and returns the status of the first
check that fails:

1. Authentication, authorization and routing: `401`, `403`, and `404` for an
   unknown route or an unadvertised capability.
2. Request boundary: a missing required `If-Match` (`428`) or a malformed one
   (`400`), then `Content-Type` (`415`), body size (`413`), and parameter and
   body schema (`400`).
3. Idempotent replay, when the request carries `Idempotency-Key`: a retained
   key with the same body returns the original response and no later check
   runs, the same key with a different body returns `409 idempotency_conflict`,
   and a replay store full of unfinished operations returns `503`. See
   [replay](operations.html#Replay).
4. Precondition: `412` when `If-Match` no longer matches.
5. Semantic validation: `422`, including error diagnostics from full
   validation of a configuration candidate.
6. Current state: `409`.

A rate limit (`429`) or full shared capacity (`503`) is reported when the
request is admitted, after the checks it passed. Two exceptions: source
creation returns `409` for a `path` already in use before it validates the
content, and a configuration write decides the listener-settings `403` during
validation. The table below defines each status. Endpoint pages link here
instead of repeating the order; an endpoint page names only which of its own
cases fall in which row.

| Status | Code | The request fails because |
|--------|------|---------------------------|
| 400 | `invalid_request` | It cannot be parsed, or a parameter or field is outside its schema: wrong type, a missing field, a field the schema does not define, a value outside the schema's enum, range or length, or a scalar value above a bound the capabilities advertise, such as a page `limit` above `max_page_size`. A page cursor sent with different filters or a different `limit` is also `400`. |
| 413 | `request_too_large` | The payload, or the fan-out the request asks for, exceeds an advertised bound: the body size, the number of operations in a group patch (`max_patch_operations`), the matching live entries a bulk close selects, including non-closable ones (`max_bulk_close`), or the targets or results of a probe or trace. |
| 428 | `precondition_required` | A required `If-Match` header is missing. |
| 412 | `stale_revision` | `If-Match` names a revision or content hash that is no longer current. |
| 422 | `unsupported_value` | It is well-formed and within every bound, but this engine does not support its meaning: an enum member or field the schema defines and the capabilities do not advertise, or a combination of fields or capabilities the engine does not implement. Error diagnostics from full validation of a configuration candidate are also `422`. |
| 409 | `state_conflict` | The request is supported, but the current state prevents it: a name already in use, a referenced object that is not current, or a transition the current state does not allow. The same request can succeed after the state changes. |
| 429 | `rate_limited` | The caller exceeded a request-rate limit, or a limit on repeating the same work, such as a second probe of a target that already has one admitted. |
| 503 | `temporarily_unavailable`, `snapshot_unavailable` | A shared capacity limit is full (a bounded queue, the stream subscriber slots, the snapshot memory budget), or a required runtime component is unavailable. |

A rejection that depends on the current state is `409`, never `422`: `422`
depends only on the request and on what the engine supports, so a `400` or `422`
does not succeed when retried unchanged against the same configuration. A `412` or `409` may succeed after the client reads the current
state again, and a `429` or `503` may succeed after `Retry-After`.

Responses with `429` or retryable `503` include `Retry-After`. A `503` from a
write the server could not confirm, such as a group selection, may still have
taken effect; read the resource back before retrying. Errors must not
contain bearer secrets, proxy credentials, private keys, raw configuration,
stack traces, local file paths, or unredacted chained engine errors.

## Page cursors

Every paged list (`GET /nodes`, `/providers`, `/flows`, `/dns/cache`,
`/dns/log`) takes an opaque `cursor` from the previous page's `next_cursor`. The
cursor is bound to the running instance, the endpoint and resource it pages,
the retained snapshot or record, the filters, and `limit`.

- A cursor the server no longer recognises returns `410 snapshot_expired`: its
  snapshot expired or was evicted, its record left the ring, the process
  restarted, the server never issued it, or it was issued for another endpoint
  or resource. Discard the cursor and restart the
  walk without one.
- A recognised cursor sent with different filters or a different `limit`
  returns `400 invalid_request`. To change either, restart the walk without a
  cursor.
- A server never continues a walk against a different snapshot.

A list `limit` is 1–1000 unless the resource advertises a lower
`max_page_size`; a larger value returns `400 invalid_request`, not a shorter
page.

## Deleting what is not there

Closing a connection returns `404 resource_not_found` when the ID is unknown or
already gone. Deleting a node or provider by an unknown ID, or deleting DNS
cache entries by an ID or filter that matches nothing, returns `200` with
`deleted: 0`. A connection close acts on one live object and reports whether
this call closed it, while the other deletes ask for an end state, absent,
that already holds.

## Activation outcomes

Activation publishes a new runtime generation. A configuration write may be
stored before or after activation; a plain reload stores nothing. For a reload,
a source replacement or creation, a node or provider create or delete, or a
group patch that edits the configuration, an activation failure reports its
outcome in `error.details`:

| Detail | Type | Meaning |
|--------|------|---------|
| `written` | boolean | The store holds the change after the failure. A plain reload stores nothing and omits it. |
| `committed` | boolean or null | Whether the new generation is active. Present on every activation failure. |
| `active_generation_id` | string or null | Present when `committed` is `true`: the active generation, or `null` when the server cannot name it. |
| `stage` | string | Synchronous responses only: the outcome code, or an adapter-defined code for a failure before activation starts. |
| `durability_confirmed` | boolean | Optional. `false` when the store holds the change but could not confirm that it survives a crash. |

- `committed: false`: the change never became active, and the previous
  generation is still active.
- `committed: true`: the new generation is active, but activation did not
  complete cleanly. The request still fails. Treat the change as applied and
  refetch the configuration and runtime.
- `committed: null`: the server cannot tell. Read `GET /runtime` back and
  compare `generation.active_id` before retrying.

`written` and `committed` are independent: storage can succeed without
activation, or activation without storage. For source-creation rollback and
recovery, see [creating a source](configuration.html#Creating-a-source).

A failed operation carries the outcome code in `error.code`. A synchronous
request returns an HTTP error, usually `503 temporarily_unavailable`, and
carries the outcome code in `error.details.stage`. An adapter uses each code
below when its case applies. `supervisor_reconciliation_failed` and
`store_unavailable` apply only to an engine with a separate worker supervisor
or a store it records after activation; other engines never report them.

| Code | `committed` | Meaning |
|------|-------------|---------|
| `reload_rejected` | `false` | The engine refused the new configuration. |
| `reload_degraded` | `true` | The new generation is active, but part of the datapath did not load. |
| `supervisor_reconciliation_failed` | `true` | The new generation is active, but the engine could not bring its workers in line with it. |
| `activation_unconfirmed` | `null` | Activation started and the server lost track of it, for example because the engine stopped. |
| `store_unavailable` | `true` | The new generation is active, but the store could not record it. `written` is `false`, and a restart loads the previously stored configuration. |

A failure before activation starts, such as an unavailable engine, has
`committed: false` and may use another adapter-defined code.

These outcomes are reported only by an instance that survives the failure. If
the engine process stops or restarts, queued and running operations and their
outcomes can be lost, and a new instance returns `404` for their IDs. Read
`GET /runtime` and `GET /config` from the new instance before retrying.

## Endpoint-specific recovery

- [Connection closing](connections.html#Closing) defines unfiltered-close consent,
  ownership conflicts, bulk limits, repeated synchronous DELETE behavior, and the
  counts a bulk close reports when it fails partway.
- [Providers](providers.html) defines refresh conflicts and queue limits.
- [Configuration editing](configuration.html#Editing) defines source-hash
  preconditions, validation diagnostics, and recovery after failed writes or reloads.

These operations use the existing error codes above; they do not introduce
endpoint-specific HTTP error codes.
