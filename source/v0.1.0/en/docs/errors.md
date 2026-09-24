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
`provider.last_error`) carry an adapter-defined code.

| Status | Typical code | Meaning |
|--------|--------------|---------|
| 400 | `invalid_request` | Malformed parameter or request shape. |
| 401 | `authentication_required` | Credentials are missing or invalid. |
| 403 | `permission_denied` | The caller lacks the required permission, or listener security policy rejects the request. |
| 404 | `resource_not_found` | The requested resource does not exist. |
| 404 | `capability_not_supported` | The running adapter does not expose the resource or action. |
| 409 | `state_conflict` | Current runtime state prevents the requested transition. |
| 409 | `idempotency_conflict` | An idempotency key was reused with a different request body. |
| 409 | `event_cursor_expired` | Event or log SSE cursor cannot be replayed; open a fresh stream and establish a new baseline. |
| 409 | `snapshot_unavailable` | Routing simulation or the running rule list could not pin a consistent generation. |
| 410 | `snapshot_expired` | Paginated flow snapshot expired; restart the page walk. |
| 410 | `flow_expired` | Flow evidence was evicted/expired and a tombstone still exists. |
| 412 | `stale_revision` | `If-Match` does not match the current resource revision or on-disk source content hash. |
| 413 | `request_too_large` | Request or requested fan-out exceeds an advertised limit. |
| 415 | `unsupported_media_type` | Request `Content-Type` is unsupported. |
| 422 | `unsupported_value` | Unsupported field, value, or transition, or error diagnostics from full validation of a source replacement. |
| 428 | `precondition_required` | A required `If-Match` header is missing. |
| 429 | `rate_limited` | A request or operation limit was reached. |
| 503 | `temporarily_unavailable` | A bounded queue or required runtime component is unavailable. |

Responses with `429` or retryable `503` include `Retry-After`. Errors must not
contain bearer secrets, proxy credentials, private keys, raw configuration,
stack traces, local file paths, or unredacted chained engine errors.

## Endpoint-specific recovery

- [Connection closing](connections.html#Closing) defines unfiltered-close consent,
  ownership conflicts, bulk limits, and repeated synchronous DELETE behavior.
- [Providers](providers.html) defines refresh conflicts, queue limits, and invalid
  page cursors.
- [Configuration editing](configuration.html#Editing) defines source-hash
  preconditions, validation diagnostics, and recovery after failed writes or reloads.

These operations use the existing error codes above; they do not introduce
endpoint-specific HTTP error codes.
