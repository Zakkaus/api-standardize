---
title: Nodes
---

# GET /api/v1/nodes

> Draft endpoint. Returns node identity and the latest typed health samples.
> New measurements are started with `POST /api/v1/probes`; reading this resource
> never starts network traffic.

## Request

{% api_request listNodes %}

## Query parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| group_id | string | - | Return direct members of one group. |
| limit | int | 100 | Maximum nodes to return; capped at 1000. |
| cursor | string | - | Opaque cursor returned by `next_cursor`. |

The server binds cursors to the running adapter instance, filters, and
retained snapshot. Restart, changed filters, or snapshot expiry/eviction invalidates
them. The server rejects unknown or invalidated cursors with
`400 invalid_request`; discard the cursor and restart the page walk without it.
If the server cannot retain the snapshot within its budget, it returns
`503 snapshot_unavailable` with `Retry-After`.

## Response

### Success (200 OK)

{% api_example listNodes 200 nodes %}

### Fields

| Field | Type | Description |
|-------|------|-------------|
| observed_at | string | Snapshot timestamp (RFC3339). |
| nodes | array | Nodes visible to the adapter. |
| nodes[].id | string | Opaque stable node identifier. |
| nodes[].name | string | Engine-visible node name. |
| nodes[].protocol | string or null | Protocol label when safely available. |
| nodes[].subscription_tag | string or null | Current subscription provenance, using the engine's `subtag(...)` name; null for manual nodes or unavailable provenance. Never expose subscription URLs or credentials. |
| nodes[].provider_id | string or null, optional | Identity from [providers](providers.html), for grouping nodes. Omitted or null when provenance is unavailable; never infer it from names or URLs. |
| nodes[].group_ids | array | Direct group memberships. |
| nodes[].health | array | Latest observations keyed by transport, purpose, measurement, destination IP family, and warmth. |
| next_cursor | string or null | Cursor for the next page. |

Health `state` is `healthy`, `unavailable`, or `unknown`. Failed or unknown
latency is `null`, never `0`; `error` is a safe machine-readable code. Clients
must not derive node IDs from names.
Missing measurements and optimistically-alive native state are `unknown`,
not evidence of a healthy probe. A restored/derived sample retains its source
label and must not be displayed as a fresh independent measurement.

A single-latency column MUST pick and label one fixed
`(transport, purpose, measurement, ip_version, warmth)` tuple. Show unknown
when that tuple has no usable sample; observations with other tuples are not
substitutes. Each tuple is unique within `node.health`.

## Shared health dimensions and metrics

Node health and group `runtime.health[]` use the same observation fields:

| Field | Meaning |
|-------|---------|
| transport | `tcp` or `udp`; not the proxy protocol's underlying tunnel transport. |
| purpose | `data`, `dns`, or `shared`. DNS-UDP and data-UDP MUST NOT collapse into one key. `shared` means the engine genuinely shares an observation collection; do not duplicate it as independently measured DNS/data. |
| ip_version | `ipv4` or `ipv6`, for the check destination, not necessarily the proxy server. |
| warmth | `cold`, `warm`, `mixed`, or `unknown`. Existing undifferentiated histories are `mixed`/`unknown`, never guessed cold. |
| latency_ms | Last real completed sample, excluding all synthetic timeout placeholders and ranking offsets. Null when that observation failed or is unavailable. Zero is valid only for an actual measured zero, not a failure sentinel. |
| moving_avg_ms | Recursive halving average of real successful samples: first sample initializes it; each next value is `(previous + sample) / 2`. Null if that exact metric is unavailable. |
| avg10_ms | Arithmetic mean of the last up to ten real successful samples; null before a real sample or when that exact metric is unavailable. |
| observed_at | Time of the latest observation, not the HTTP request time. |
| measurement | `tcp_connect`, `http_headers`, `http_round_trip`, `dns_round_trip`, `quic_handshake`, `mixed`, or `unknown`. Never label warm HTTP RTT or QUIC setup as a cold full connection measurement. |
| sample_source | `probe`, `traffic`, `restored`, `derived`, `mixed`, or `unknown`. Copying one measurement across health domains/families is derived evidence, not independent probes. |
| error | Safe machine-readable failure code or null. |

Neither average includes failure penalties, synthetic timeout samples,
group `add_latency`, or tolerance. Historical averages may survive a failed
latest probe; `state` and `observed_at` still describe the latest observation.
Engines with different formulas must return null for the canonical average,
not relabel their native statistic. In particular, parsing `min_avg10` does
not prove that an engine ranks by an average of ten.

Latency history is out of scope for this draft; clients sample
`moving_avg_ms`/`avg10_ms` to maintain their own series.

`subscription_tag` is current node provenance, not identity. A stable node ID
can remain unchanged across subscription refresh/tag changes. Unknown and
manual provenance both yield null; the API must not infer tags from names.
Group-specific ranking belongs to the group, not a mutated node health copy.

## Example

```bash
curl "http://localhost:9527/api/v1/nodes?group_id=group-proxy"
```

## Add an inline node

Adding or deleting an inline node requires `control` and `resources.nodes.can_manage`.
Listing nodes requires only `observe`. If node management is unavailable, create
and delete return `404 capability_not_supported`.

{% api_request createNode link %}

{% api_example createNode 201 created http %}

The backend parses the share link with the engine's own support, writes it
into the `node` section of its managed main source under the given name,
advances the configuration revision and emits `generation.changed`. The link
is stored and never returned. A link the engine cannot parse returns
`422 unsupported_value` with a sanitized explanation in `error.message`; never
echo the share link or raw parser output. A name already in use returns
`409 state_conflict`. The node belongs to the inline provider
and to every group whose filter matches it after reload; `health` is empty
until a probe or the engine's own checks observe it.

## Delete an inline node

`DELETE /api/v1/nodes/{id}` requires `resources.nodes.can_manage`. A node
from a subscription or file provider returns `404 capability_not_supported`:
refresh or delete its [provider](providers.html) instead.

{% api_request deleteNode %}

{% api_example deleteNode 200 deleted %}

Deletion removes the node's line from the managed main source and the node
from the running groups, advances the configuration revision and emits
`generation.changed`. It is idempotent: an unknown id returns `deleted` 0.
