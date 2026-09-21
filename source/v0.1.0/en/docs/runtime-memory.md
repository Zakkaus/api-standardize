---
title: Runtime Memory
---

# GET /api/v1/runtime/memory

> Draft endpoint. This is a lightweight, read-only memory snapshot intended for
> frequent dashboard polling. It does not enumerate connections or eBPF map
> entries.

Process, cgroup, and kernel memory are different scopes. Their values must not
be added together. An unsupported or unobservable metric is `null`, and an
unadvertised metric may be omitted or `null`. Decimal string `"0"` is a real measurement, never absence.

## Request

{% api_request getRuntimeMemory %}

Successful responses include `Cache-Control: no-store`.

## Response

### Success (200 OK)

{% api_example getRuntimeMemory 200 snapshot %}

### Fields

| Field | Type | Description |
|-------|------|-------------|
| observed_at | string | Snapshot timestamp (RFC3339). |
| process | object or null | Memory attributed to the engine process. |
| process.rss_bytes | decimal uint64 string or null, optional | Resident set size reported by the operating system. |
| cgroup | object or null | Effective cgroup memory accounting when available. |
| cgroup.scope | string | `service`, `shared`, or `unknown`. |
| cgroup.current_bytes | decimal uint64 string or null, optional | Current cgroup memory usage. |
| cgroup.limit_bytes | decimal uint64 string or null, optional | Effective hard limit; `null` when unlimited or unknown. |
| cgroup.events | object or null, optional | Counters from the effective cgroup memory controller; the container may be omitted when no event metrics are advertised. |
| cgroup.events.high | decimal uint64 string or null, optional | Number of times the high boundary was reached. |
| cgroup.events.oom | decimal uint64 string or null, optional | Number of observed allocation failures caused by cgroup OOM. |
| cgroup.events.oom_kill | decimal uint64 string or null, optional | Number of processes killed by the cgroup OOM killer. |
| kernel | object or null | Kernel memory attributable to the engine when observable. |
| kernel.ebpf_bytes | decimal uint64 string or null, optional | Memory attributable to eBPF maps and programs. |
| kernel.sampled_at | string or null | Timestamp of the cached kernel-memory sample. |

An implementation must not walk every eBPF map entry in the request path.
Kernel memory may be sampled asynchronously and reused across requests;
`kernel.sampled_at` lets clients show that it is older than the process and
cgroup sample.

Go heap statistics, Rust allocator statistics, and the Clash-compatible
`memory` field are implementation-specific and are not canonical native fields.
Feature availability is advertised by `GET /api/v1/capabilities`.

For dashboard polling, use an interval of at least one second. If the server
returns `429`, honor `Retry-After`. `resources.runtime_memory.metrics` lists the
supported snapshot metrics; it does not advertise a polling interval.

## Example

```bash
curl http://localhost:9527/api/v1/runtime/memory
```

## GET /api/v1/runtime/memory/history

Requires `observe` and `resources.memory_history.available`. The producer records
process RSS, cgroup current usage, and optional eBPF memory in a bounded in-memory
ring independently of HTTP reads. Unavailable measurements remain null.
Cgroup limits and event counters are snapshot-only fields.

### Request

{% api_request getMemoryHistory %}

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| window_seconds | positive safe integer | Advertised `max_window_seconds` | Look-back window ending at `observed_at`. |
| max_points | positive safe integer | Advertised `max_points` | Maximum returned sample count. |

Both limits are under `resources.memory_history`. Invalid, zero, negative,
or non-integer values and requests above either advertised limit return
`400 invalid_request`; the server must not silently clamp them.

{% api_example getMemoryHistory 400 window_too_large %}

{% api_example getMemoryHistory 400 too_many_points %}

### Response

{% api_example getMemoryHistory 200 recent %}

| Field | Type | Description |
|-------|------|-------------|
| observed_at | string | History snapshot timestamp (RFC3339), not a replacement for sample timestamps. |
| window_seconds | positive safe integer | Requested look-back window, even when retention is shorter. |
| sampled_every_seconds | positive number | Nominal interval between returned samples after thinning; recorder interval for an empty result. |
| samples | array | At most `max_points` samples, oldest first, in `(observed_at - window_seconds, observed_at]`. |
| samples[].sampled_at | string | Original sample timestamp (RFC3339). |
| samples[].rss_bytes | decimal uint64 string or null | Process resident set at the sample, or null when unavailable. |
| samples[].cgroup_current_bytes | decimal uint64 string or null | cgroup `memory.current` at the sample, or null when unavailable. |
| samples[].kernel_ebpf_bytes | decimal uint64 string or null | Kernel eBPF memory at the sample; omitted or null when not advertised. |

Retention, thinning, gaps and restart clearing follow
[traffic history](runtime-status.html#GET-api-v1-runtime-traffic-history): pick
every Nth stored sample backwards from the newest to fit `max_points`, keep
original timestamps and values, leave missed intervals as gaps, and never
fabricate a zero. SSE does not replay memory history; fetch it on first open
or reconnect.
