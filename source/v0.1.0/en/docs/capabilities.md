---
title: Capabilities
---

# GET /api/v1/capabilities

> Draft endpoint. This is the authoritative coarse-grained feature declaration
> for the running adapter. Resource responses may further narrow capabilities
> for an individual node or group.

## Request

{% api_request getCapabilities %}

## Response

### Success (200 OK)

{% api_example getCapabilities 200 available %}

### Rules

- Every advertised resource key contains `available`.
- Top-level `limits` apply to every native route before resource-specific work
  is dispatched.
- A resource with `available: false` may omit its remaining fields.
- Optional metrics, enum values, and operation limits are explicit arrays or
  objects; clients must not infer them from the engine version.
- Unknown resource keys and fields must be ignored by clients.
- Requesting an unavailable resource or action returns `404` with
  `capability_not_supported`.
- Per-group and per-node capabilities may be stricter than this response.
- Limits are server-advertised ceilings. Exceeding a request rate returns
  `429`; exceeding fan-out or size returns `413`; a full bounded queue returns
  `503`. Traffic-history window and point limits instead return
  `400 invalid_request`.

`runtime_memory.metrics` contains canonical response field paths. An
implementation must not advertise a metric that it always reports as `null`.
`dns_cache.entry_kinds` declares which positive or negative cache entries can
be read and mutated without silently hiding another cache class.

`runtime_outbounds.available` declares the per-outbound cumulative counter
snapshot. `traffic_history.available` declares the bounded traffic ring;
when true, `max_window_seconds` and `max_points` are required positive safe
integers. They bound the look-back window and returned sample count, not a
retention guarantee. Both resources are optional and require `observe`.

## Configuration visibility

`resources.config.available` gates effective configuration readback under
`observe`, including single-source GET. When available, the adapter must declare
`content`, `writable`, `max_bytes`, and `max_sources`.
`content` is a visibility flag, false by default: false forbids source text in
the response; true permits optional text subject to secret redaction. It does
not grant access to raw secrets. `max_sources` is a positive safe-integer bound
on the complete source set, not permission to truncate it.

`writable` is the server-wide switch for source replacement under `control`.
A source's own `writable` field can further restrict writes. A false switch or
read-only source returns `403 permission_denied`; neither grants write access
through `observe`. Generated and subscription sources are never writable.
`max_bytes` is a positive safe-integer limit on UTF-8 replacement content, not
character count. The shared JSON body limit also applies; excess returns
`413 request_too_large`.

Advertising `writable: true` requires full validation and asynchronous reload
support, with `resources.reload.available` and `resources.operations.available`
both true. Editing is independent of the optional dry-run endpoint and of
content visibility. It does not grant permission to read secrets.

Path redaction follows the [shared visibility rules](api-config.html#Permissions).
Use `<redacted>` for hidden display paths. Apply privacy filters consistently
to paths, source text, and diagnostics; `detail=summary` is not a privacy tier.
The adapter sets `secrets_redacted` when it withholds content or redacts data.

`resources.config_validate.available` independently gates dry-run validation
under `control`; the request body may contain secrets. When available, the
adapter must declare `modes` as a nonempty unique subset of `syntax` and `full`.
It must also declare `max_bytes` and `max_sources` as positive safe integers.
The limits bound total UTF-8 source bytes and source count, including locally
resolved dependencies in `full` mode. The shared JSON body ceiling also applies. Exceeding a size or
source-count limit returns `413 request_too_large`; an unadvertised mode returns
`422 unsupported_value`. Neither mode permits network access or state changes.
See [Configuration](configuration.html) for request and diagnostic semantics.

## Conformance profiles

`profiles` is an array, not a feature inferred from engine identity. The
example is an illustrative partial adapter, **not honk's current response**.

- **`base`** requires discovery, version, capabilities, runtime, the shared
  authentication/error/visibility rules, and honest capability declarations.
  Every resource key in this page's `resources` object MUST have an entry,
  even when unavailable; discovery/version/capabilities themselves are mandatory.
  Operations are required whenever an advertised action is asynchronous;
  events and mutations are otherwise optional. dae can implement this
  profile without claiming honk-only features.
- **`full_transparency`** additionally requires nodes, groups, connections,
  recorded flows and events; observed rule inputs/short-circuit decisions,
  dial-mode verification, DNS linkage, reroute reasons, actual member/leaf
  attempts, and lifecycle outcomes for managed traffic, including direct and
  blocked decisions. It requires all recorded-flow acceptance scenarios,
  no intentional sampling in these scopes, and explicit loss/retention
  accounting. Early bypass scope may remain uninstrumented only if declared
  as an exclusion; this is not a claim to observe all host traffic.

Profile support describes implemented instrumentation, not losslessness of
every snapshot. Buffer loss, disabled recording or redaction downgrades the
current coverage and affected traces even on a conforming engine. A
userspace-only adapter MUST NOT advertise `full_transparency`. A simulator,
Clash connection list, log parser, or map snapshot cannot satisfy it.

## Example

```bash
curl http://localhost:9527/api/v1/capabilities
```
