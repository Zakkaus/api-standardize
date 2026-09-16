---
title: Runtime
---

# GET /api/v1/runtime

> Draft endpoint. This read-only snapshot describes the running process, active
> configuration generation, eBPF datapath summary, and traffic visible to the
> engine. Detailed eBPF state is available from [`GET /api/v1/datapath`](datapath.html),
> and the independently pollable memory snapshot is available from
> [`GET /api/v1/runtime/memory`](runtime-memory.html).

Runtime values are observations, not a promise that the engine can see every
packet on the host. Unsupported or unobservable values are `null`; bounded
counts use numeric `0`, while uint64 quantities use decimal string `"0"`.

## Request

{% api_request getRuntime %}

`detail=summary` is the default and omits `process.pid`. `detail=full` includes
it when the adapter can observe it.

## Response

### Success (200 OK)

{% api_example getRuntime 200 snapshot %}

### Fields

| Field | Type | Description |
|-------|------|-------------|
| observed_at | string | Snapshot timestamp (RFC3339). |
| instance_id | string | Unique adapter process incarnation; changes on restart. |
| lifecycle.state | string | `starting`, `running`, `reloading`, `suspended`, `draining`, `degraded`, or `failed`. |
| lifecycle.started_at | string or null | Process start time, when known. |
| lifecycle.uptime_seconds | decimal uint64 string or null | Process uptime. |
| generation.active_id | string | Opaque active runtime generation. |
| generation.config_revision | opaque string or null | Configuration revision used by the active generation; preserve it without numeric parsing. |
| generation.state | string | `active` or `reloading`. A pending generation is not active. |
| datapath.kind | string | `ebpf`, `userspace`, `mock`, or `unknown`. |
| datapath.state | string | `active`, `degraded`, `detached`, `failed`, `disabled`, or `unknown`. |
| datapath.visibility | string | `full`, `partial`, or `none` for traffic visible to the datapath. |
| datapath.ebpf | object or null | eBPF state summary when the datapath uses eBPF. |
| traffic.scope | string | Scope of the counters, normally `visible`. |
| traffic.observed_by | string | `userspace`, `ebpf`, or `mixed`. |
| traffic.counter_since | string or null | Start time of the reported cumulative counters. |
| traffic.sampled_at | string or null | Traffic sample timestamp (RFC3339), or null when unavailable. Never substitute the HTTP snapshot timestamp. |
| traffic.connections | object | Currently visible TCP, UDP, and total connection counts. Each count is a bounded JSON integer or `null` when unobservable. |
| traffic.bytes | object | Cumulative visible bytes. Each value is a decimal uint64 string or `null` when unobservable. |
| traffic.rates | object or null | Current rates. `null` when unavailable; `window_seconds` stays numeric and byte rates are decimal uint64 strings or `null`. |
| process.pid | uint32 or null, optional | Engine process ID with `detail=full`. |
| process.cpu_percent | number or null | Process CPU usage when available. |
| last_reload | object or null | Most recent reload operation and its result. |

`traffic.rates.window_seconds` is the duration of the sampling interval
ending at `traffic.sampled_at`. A cached sample retains its original
timestamp; `counter_since` instead marks the cumulative counter reset
boundary. A null sample timestamp does not establish freshness.

The `datapath.ebpf` summary uses these states:

| Field | Values | Meaning |
|-------|--------|---------|
| backend | `real`, `mock`, `unknown` | Backend used by the engine. |
| programs | `loaded`, `not_loaded`, `error`, `unknown` | Whether eBPF programs are loaded. |
| hooks | `attached`, `partially_attached`, `detached`, `unknown` | Whether required hooks are mounted. |
| routing.state | `published`, `not_published`, `error`, `unknown` | Whether routing is visible to eBPF. |
| routing.generation_id | string or null | Generation currently published to eBPF. |
| health | `healthy`, `degraded`, `failed`, `unknown` | Combined operational result. |

For `datapath.kind: ebpf`, `datapath.state` may be `active` only when the
required programs, hooks, and active routing publication are all valid.
A loaded program alone is not an active datapath. Userspace and mock state
rules are defined in [Datapath](datapath.html).

> **Note:** Per-connection details and byte counters are available from
> [`GET /api/v1/connections`](connections.html). They carry the same visibility limits.

Per-outbound cumulative counters and bounded traffic history are separate
resources below. Summing live connection bytes by `outbound` omits closed,
truncated, and unobserved connections; it is not a usage total.

Memory metrics are intentionally excluded from this snapshot so a dashboard
can poll [`GET /api/v1/runtime/memory`](runtime-memory.html) without repeatedly fetching
generation, datapath, traffic, and reload state.

During reload, the old active generation remains reported until the new
generation has passed configuration validation and datapath publication. A
failed reload therefore leaves `generation.active_id` unchanged and is exposed
through `last_reload`.

Generation identifiers are adapter-owned, instance-scoped opaque references
with distinct namespaces for runtime commits and kernel policy publications.
DNS cache epochs, outbound-registry generations, diagnostic generations and
eBPF double-buffer slot numbers are not interchangeable configuration
revisions. A reload that reuses an unchanged kernel policy can promote a new
runtime generation while retaining the old datapath generation ID. The
adapter must retain that relationship, not forge equal strings.

Runtime fields are a coherent control-plane snapshot; independently sampled
kernel/traffic counters retain their own timestamps. Reads of two separate
HTTP resources are not an atomic transaction. Flow steps capture their
actual producer generation and may legitimately span multiple generations.

## Example

```bash
curl "http://localhost:9527/api/v1/runtime?detail=full"
```

## GET /api/v1/runtime/outbounds

Requires `observe` and `resources.runtime_outbounds.available`. This snapshot
mirrors honk's Clash-surface [`/stats` outbound counters](honk-mapping.html#outbound-counters),
not a sum of the current `/connections` page.

{% api_request getRuntimeOutbounds %}

{% api_example getRuntimeOutbounds 200 snapshot %}

| Field | Type | Description |
|-------|------|-------------|
| observed_at | string | Counter snapshot timestamp (RFC3339). |
| counter_since | string | Shared start/reset boundary for all cumulative counters (RFC3339). |
| outbounds | array | Counters attributed to engine-visible outbounds. |
| outbounds[].name | string | Outbound name retained with the counters, not a stable node/group ID. |
| outbounds[].kind | string | `group`: configured group; `node`: leaf node; `builtin`: engine builtin such as direct/block. |
| outbounds[].active_connections | safe unsigned integer | Currently active connections attributed to this outbound. |
| outbounds[].total_connections | decimal uint64 string | Cumulative connections attributed to this outbound since `counter_since`. |
| outbounds[].upload_bytes | decimal uint64 string | Cumulative visible uploaded bytes since `counter_since`. |
| outbounds[].download_bytes | decimal uint64 string | Cumulative visible downloaded bytes since `counter_since`. |
| outbounds[].errors | decimal uint64 string | Cumulative outbound failures since `counter_since`; policy blocks are not errors. |

Restart or counter reset changes `counter_since`; clients must not compute
deltas across that boundary. A reload changes it only if the counters reset.
Closed connections remain in cumulative totals. Newly observed outbounds
start at zero within the same interval; retain old names and kinds with
their counters rather than relabelling them from today's registry.
Rows reflect the producer's attribution, not every group and node on a
selection path; do not duplicate counters across `chain` entries.
These counters cover visible traffic only, not all kernel-direct or blocked
traffic. Zero denotes a measured zero, never unsupported accounting.

## GET /api/v1/runtime/traffic/history

Requires `observe` and `resources.traffic_history.available`. The producer
samples visible runtime rates and active connection counts into a bounded
in-memory ring independently of HTTP reads.

### Request

{% api_request getTrafficHistory %}

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| window_seconds | positive safe integer | Advertised `max_window_seconds` | Look-back window ending at `observed_at`. |
| max_points | positive safe integer | Advertised `max_points` | Maximum returned sample count. |

Both limits are under `resources.traffic_history`. Invalid, zero, negative,
or non-integer values and requests above either advertised limit return
`400 invalid_request`; the server must not silently clamp them.

{% api_example getTrafficHistory 400 window_too_large %}

{% api_example getTrafficHistory 400 too_many_points %}

### Response

{% api_example getTrafficHistory 200 recent %}

| Field | Type | Description |
|-------|------|-------------|
| observed_at | string | History snapshot timestamp (RFC3339), not a replacement for sample timestamps. |
| window_seconds | positive safe integer | Requested look-back window, even when retention is shorter. |
| sampled_every_seconds | positive number | Nominal interval between returned samples after thinning; recorder interval for an empty result. |
| samples | array | At most `max_points` samples, oldest first, in `(observed_at - window_seconds, observed_at]`. |
| samples[].sampled_at | string | Original sample timestamp (RFC3339). |
| samples[].upload_bytes_per_second | decimal uint64 string or null | Sampled visible upload rate, or null when unavailable. |
| samples[].download_bytes_per_second | decimal uint64 string or null | Sampled visible download rate, or null when unavailable. |
| samples[].connections | safe unsigned integer or null | Visible active TCP and UDP connections at the sample, or null when unavailable. |

When the window holds too many points, select every Nth stored sample
backwards from the newest to fit `max_points`, then return them oldest
first. Choose the smallest positive N that fits the limit. Preserve original
timestamps and rates; `sampled_every_seconds` describes the resulting
cadence, not a new rate averaging interval.
Missed intervals remain timestamp gaps; unavailable measurements are null,
not zero. A cumulative counter reset makes the spanning rate sample null,
not a negative rate or a fabricated spike.

The ring is bounded by age and capacity and is cleared on process restart.
It may return fewer samples than requested, or an empty array before
sampling; a requested window is not a retention guarantee.
Together with [memory history](runtime-memory.html#get-apiv1runtimememoryhistory)
this is the only sampled-metric history the native API serves; retained
flow traces and operation results remain separate records. SSE does not
replay traffic history, even with `Last-Event-ID`; fetch this resource on
first open or reconnect rather than treating invalidations as samples.
