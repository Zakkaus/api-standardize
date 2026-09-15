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
| traffic.sampled_at | string or null | Required time the traffic sample was taken; null when unavailable, not replaced by the HTTP snapshot time. |
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

The draft has no per-outbound cumulative counters or traffic history.
Summing live connection bytes by `outbound` is only a bounded snapshot
derivation: it omits closed, truncated, and unobserved connections and is
not a usage total. SSE invalidations do not recover historical traffic samples.

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
