---
title: Connections
---

# GET /api/v1/connections

> Draft endpoint. Real-direct flows can bypass userspace, so this list is not
> necessarily a complete packet-flow inventory. Native responses label
> `observed_by` and use `null` when a counter is unavailable.

Returns a list of visible TCP and UDP connections, including per-connection
network speeds where the observation plane provides them.

## Request

{% api_request listConnections %}

## Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| type | string | all | Filter: `tcp`, `udp`, or `all` |
| src | string | - | Exact source IP literal without a port; applied with `type` before `limit`. |
| limit | int | 100 | Max connections to return across both arrays; capped at 1000. |
| detail | string | summary | `summary` omits `src`, `dst`, and `domain`; `full` includes them when observable. |

## Response

### Success (200 OK)

{% api_example listConnections 200 visible %}

### Fields

| Field | Type | Description |
|-------|------|-------------|
| observed_at | string | Snapshot timestamp (RFC3339). |
| instance_id | string | Running adapter instance; resets on process restart. |
| visibility | string | `full`, `partial`, or `none`. |
| truncated | bool | Whether `limit` omitted visible entries matching `type` and `src`. |
| tcp | array | Active TCP connections |
| udp | array | Active UDP sessions |
| total_tcp | int | Visible active TCP count matching `type` and `src`, before `limit`. |
| total_udp | int | Visible active UDP count matching `type` and `src`, before `limit`. |

### Connection Object

| Field | Type | Description |
|-------|------|-------------|
| id | string | Opaque connection identifier |
| flow_id | string or null | Related recorded-flow ID, if correlation is known; not derived from a tuple. |
| pname | string or null | Captured process name; null without process context. Included in summary. |
| state | string | Observed lifecycle state from the flow contract, or unknown. |
| src | string, optional | Source address (ip:port), present with `detail=full` |
| dst | string, optional | Destination address (ip:port), present with `detail=full` |
| domain | string or null, optional | Sniffed domain with `detail=full`, or `null` when unknown |
| outbound | string or null | Effective routed outbound, not a leaf name masquerading as a group. |
| chain | array of strings | Application outbound `selection_path` group IDs followed by the leaf node ID, in order; empty for direct/block or an unknown path. |
| chain_source | string | `evaluation`: captured at selection; `reconstructed`: recovered from retained evidence; `unknown`: unavailable. |
| rule_id | string or null | Generation-scoped traffic rule ID, or null when unavailable. |
| rule_expression | string or null | Sanitized display expression for that rule, or null when unavailable. |
| rule_source | string | `kernel`: deciding kernel rule; `recomputed`: userspace recomputation, not the deciding kernel rule; `unknown`: unavailable provenance. |
| ingress | string or null | `lan` or `wan` when captured; null when unavailable. |
| domain_source | string or null | `tls_sni`, `http_host`, `quic_sni`, `dns_mapping`, `explicit`, or `unknown`; null without domain evidence. |
| started_at | string or null | Actual start time if recorded; null if only post-dial registration time is known. |
| observed_by | string | `userspace`, `ebpf`, or `mixed` |
| upload_bytes | decimal uint64 string or null | Visible uploaded bytes |
| download_bytes | decimal uint64 string or null | Visible downloaded bytes |
| upload_bytes_per_second | decimal uint64 string or null | Visible upload rate |
| download_bytes_per_second | decimal uint64 string or null | Visible download rate |

> **Note:** Visible network speed and connection totals are available
> from [`GET /api/v1/runtime`](runtime-status.html). The datapath may observe only a
> subset of host traffic.

When the matching entries across both arrays exceed `limit`, the server
returns the most recently observed entries first with a stable tie-breaker
and sets `truncated: true`. Totals are the complete matching counts visible
at `observed_at`, not only the returned array sizes.

Summary reduces payload; it does not confer less-sensitive access. `pname`,
addresses, domains and list-view evidence all require `observe`. `chain`,
`chain_source`, `rule_id`, `rule_expression`, `rule_source`, `ingress`, and
`domain_source` are required in both detail tiers and share the
[flow-summary contract](flows.html#List-view-fields). The list carries the
application selection, not a DNS helper's path. The full decision timeline
and DNS provenance remain at [`GET /api/v1/flows/{flow_id}`](flows.html).

As [honk's `matched_rule` evidence](honk-mapping.html#matched-rule) shows,
a recomputed rule can differ from the deciding kernel rule. Do not relabel
it as `kernel` or use today's group selection to fill an unknown chain.
Inbound identity beyond `ingress` is out of scope for this draft.

Totals count visible live entries after the `type` and exact source-IP `src`
filters (the excluded transport has count zero); absence from this snapshot
is not evidence of a clean close. `/flows` records failed/blocked attempts
and recently terminated flows. [Closing](#Closing) requires actual transport
cancellation or session retirement; [tracker deletion](honk-mapping.html#tracker-deletion)
alone only removes an observation.

The supported client/device view groups the source IP from `src` over
`detail=full` entries, ignoring the source port. This derivation is bounded
by `limit`; use the `src` filter for a per-address drill-down, not tuple
guessing or device identity inference. MAC addresses and client/device
first-seen timestamps are not on the `/connections` wire. `started_at`
describes a connection, not when the client/device was first seen.

## Example

```bash
curl "http://localhost:9527/api/v1/connections?type=tcp&limit=10&detail=full"
```

## Closing

Both DELETE endpoints require `control` permission and
`resources.connections.available: true` with `can_close: true`. Otherwise,
they return `404 capability_not_supported`. The list still requires only
`observe`; availability of the list does not imply permission or support
for closing.

### What is closable

The userspace datapath must own the TCP transport or UDP session and be able
to cancel the transport or retire the session. Removing a tracker entry is
not sufficient. `observed_by` identifies the observation plane, not ownership:
`userspace` or `mixed` evidence alone does not guarantee that closing is possible.
Kernel-direct and kernel-bypassed flows (`kernel_direct` and `kernel_bypass`
scopes, including `ebpf`-only observations) are not closable. An outbound
named `direct` alone does not determine ownership.

### Single connection

`DELETE /api/v1/connections/{connection_id}` uses the opaque ID from the list,
not a tuple or a recorded-flow ID. It returns `204` only after cancellation
or retirement, with no response body or `Content-Type`. The cache and nosniff
headers remain mandatory.

{% api_request closeConnection %}

{% api_example closeConnection 204 closed http %}

An unknown or already-gone ID returns `404 resource_not_found`:

{% api_example closeConnection 404 gone %}

An observed connection that is not closable returns `409 state_conflict`:

{% api_example closeConnection 409 not_closable %}

Both DELETE endpoints accept `Idempotency-Key`, as other control calls do.
These synchronous calls evaluate current live state even with a repeated key;
they do not replay an earlier result or return a retained operation.
Closing the same ID twice therefore returns `404 resource_not_found` on
the second call, including when the key is repeated.

### Bulk close

`DELETE /api/v1/connections` closes every closable match and skips observed
matches that are not closable. It accepts the same `type` and exact source-IP
`src` filters as the list, combined with AND. Neither `outbound` nor `domain`
is a list filter in this revision. `limit` and `detail` affect list presentation
and are not accepted by bulk close.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| type | string | all | Match `tcp`, `udp`, or `all`. |
| src | string | - | Match an exact source IP literal without a port. |
| all | boolean | false | Explicitly permit an unfiltered close; supplied filters still apply. |

Without `type=tcp`, `type=udp`, or `src`, the request must include `all=true`.
Missing `type` and `type=all` are both unfiltered. Otherwise, return
`400 invalid_request` before closing anything. This safety rule prevents a
missing filter from disconnecting every userspace connection.

{% api_request closeConnections %}

{% api_example closeConnections 200 closed %}

`closed` counts connections actually cancelled or retired; `skipped` counts
selected connections that were observed but not closable. Both are JSON integers
from 0 through 9007199254740991, not decimal strings. An empty match returns
`{"closed": 0, "skipped": 0}`.

Select matching live entries once, before closing. If that count, including
non-closable entries, exceeds `resources.connections.max_bulk_close`, return
`413 request_too_large` before closing any connection; do not truncate the set.
`closed + skipped` cannot exceed that limit. New arrivals are outside the selected
set; selected entries that disappear before cancellation contribute to neither count.

Unfiltered request without explicit consent:

{% api_example closeConnections 400 unfiltered %}

### Events

Closing a recorded flow advances its terminal state and emits the existing
`flow.updated` invalidation when advertised. Its `resource_id` is the flow ID,
not the connection ID; fetch `href` for the retained flow and refresh the
connection list. Changed runtime counters use `runtime.updated`. Both retain
the existing coalescing and replay rules. An unrecorded connection does not
gain a fabricated flow ID or flow event; refresh the list after success.
There is no new close event kind.
