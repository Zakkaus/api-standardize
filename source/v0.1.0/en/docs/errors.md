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
in resources (`operation.error`, `datapath.errors`, `lifecycle.last_error`) carry an
adapter-defined code.

| Status | Typical code | Meaning |
|--------|--------------|---------|
| 400 | `invalid_request` | Malformed parameter or request shape. |
| 401 | `authentication_required` | Credentials are missing or invalid. |
| 403 | `permission_denied` | The authenticated caller cannot perform the action. |
| 404 | `resource_not_found` | The requested resource does not exist. |
| 404 | `capability_not_supported` | The running adapter does not expose the resource or action. |
| 409 | `state_conflict` | Current runtime state prevents the requested transition. |
| 409 | `idempotency_conflict` | An idempotency key was reused with a different request body. |
| 409 | `event_cursor_expired` | SSE cursor cannot be replayed; open a fresh stream and resnapshot. |
| 409 | `snapshot_unavailable` | Routing simulation could not pin a consistent generation. |
| 410 | `snapshot_expired` | Paginated flow snapshot expired; restart the page walk. |
| 410 | `flow_expired` | Flow evidence was evicted/expired and a tombstone still exists. |
| 412 | `stale_revision` | `If-Match` does not match the current resource revision. |
| 413 | `request_too_large` | Request or requested fan-out exceeds an advertised limit. |
| 415 | `unsupported_media_type` | Request `Content-Type` is unsupported. |
| 422 | `unsupported_value` | Syntax is valid but a field, value, or transition is unsupported. |
| 428 | `precondition_required` | A required `If-Match` header is missing. |
| 429 | `rate_limited` | A request or operation limit was reached. |
| 503 | `temporarily_unavailable` | A bounded queue or required runtime component is unavailable. |

Responses with `429` or retryable `503` include `Retry-After`. Errors must not
contain bearer secrets, proxy credentials, private keys, raw configuration,
stack traces, local file paths, or unredacted chained engine errors.

## Connection closing

Both connection DELETE endpoints require `control` permission. Closing uses
the existing error codes:

| Status | Code | Closing condition |
|--------|------|-------------------|
| 400 | `invalid_request` | Bulk close has no restricting `type` or `src` filter and lacks `all=true`, or parameters are malformed. No connections are closed. |
| 404 | `resource_not_found` | Single-close ID is unknown or already gone, including a second close of the same ID. |
| 404 | `capability_not_supported` | `resources.connections.available` or `can_close` is false; applies to both DELETE endpoints. |
| 409 | `state_conflict` | The single-close target is observed but not closable by the userspace datapath, including kernel-direct/bypassed flows. Bulk close counts such matches as `skipped` instead. |
| 413 | `request_too_large` | Selected live entries exceed `resources.connections.max_bulk_close`, including non-closable matches. Reject before closing anything. |

`type=all` is not a restricting filter. The explicit `all=true` requirement
prevents an omitted filter from disconnecting every userspace connection.
`Idempotency-Key` does not replay a previous synchronous DELETE result:
closing an already-gone ID still returns `404 resource_not_found`.
