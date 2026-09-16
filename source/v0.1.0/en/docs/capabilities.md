---
title: Capabilities
---

# GET /api/v1/capabilities

> Draft endpoint. This is the authoritative coarse-grained feature declaration
> for the running adapter. Resource responses may further narrow capabilities
> for an individual node or group; provider refresh support may vary by kind.

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

`logs` advertises supported `levels` and `max_buffered_records`. Its bounded
SSE feed carries sanitized log records, separately from invalidation events.
`providers` advertises `can_refresh` and `max_page_size` (1–1000); refresh
requires `control` and the operation resource. `rules` advertises `max_rules`,
including the fallback entry, for a complete running-generation dictionary.
These three resources require `observe` for reads. When available, each
resource must include its advertised fields; buffer and rule limits are
positive safe integers. See [logs](logs.html), [providers](providers.html),
and [rules](rules.html).

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

`logs.available` declares the bounded log stream; when true, `levels` and
`max_buffered_records` are required.

`runtime_settings.available` declares `GET`/`PATCH /api/v1/runtime/settings`;
when true, `fields` lists which settings the PATCH accepts on this backend.

`dns_log.available` declares the ring of recent client resolutions; when
true, `max_records` and `max_page_size` are required positive safe integers.
