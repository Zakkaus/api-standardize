---
title: Datapath
---

# GET /api/v1/datapath

> Draft endpoint. Returns detailed datapath and eBPF state. The summary is
> also included in [`GET /api/v1/runtime`](runtime-status.html).

The endpoint reports whether the datapath is loaded, attached, published, and
usable. `programs: loaded` alone does not mean that traffic is being handled.

## Request

{% api_request getDatapath %}

`detail=summary` is the default and omits interface names, attachments, and map
occupancy. `detail=full` includes the documented `attachments` and `maps`
objects when available.

## Response

### Success (200 OK)

{% api_example getDatapath 200 active %}

### Fields

| Field | Type | Description |
|-------|------|-------------|
| observed_at | string | Snapshot timestamp (RFC3339). |
| kind | string | `ebpf`, `userspace`, `mock`, or `unknown`. |
| state | string | `active`, `degraded`, `detached`, `failed`, `disabled`, or `unknown`. |
| visibility | string | `full`, `partial`, or `none`. |
| ebpf.backend | string | `real`, `mock`, or `unknown`. |
| ebpf.programs | string | `loaded`, `not_loaded`, `error`, or `unknown`. |
| ebpf.hooks | string | `attached`, `partially_attached`, `detached`, or `unknown`. |
| ebpf.routing.state | string | `published`, `not_published`, `error`, or `unknown`. |
| ebpf.routing.generation_id | string or null | Generation currently published to eBPF. |
| ebpf.routing.epoch | string or null | Engine routing epoch when exposed. |
| ebpf.attachments | array | Engine-visible hook attachments. It may be empty when details are unavailable. |
| ebpf.maps.state | string | `ready`, `partial`, `error`, or `unknown`. |
| ebpf.maps.conn_state | object or null | Conntrack occupancy when the backend exposes it. |
| ebpf.health | string | `healthy`, `degraded`, `failed`, or `unknown`. |
| ebpf.last_error | string or null | Latest safe machine-readable error code. |
| ebpf.checked_at | string | Time at which eBPF state was checked. |
| errors | array | Current safe errors using `code`, `message`, and optional `details`. |

Map `capacity` and known `occupancy` are bounded numeric counts.
`occupancy_known: false` requires `occupancy: null`, not a fabricated zero.

`ebpf.routing.generation_id` identifies the actual published kernel policy,
which must be valid for the active runtime generation. It need not equal
`generation.active_id`: unchanged policies can be reused across reloads.
A staged/pending publication is never reported as active. `epoch` is an
engine-native routing epoch, not a substitute for configuration identity or
the active double-buffer slot. Independently timed GETs may straddle reload;
compare their observation times before diagnosing a mismatch.

## State rules

- For `kind: ebpf`, `active` requires loaded programs, required hooks attached,
  and published routing for the active generation.
- For `kind: ebpf`, `degraded` means the datapath can operate only partially,
  or an important map/counter cannot be read.
- `failed` means initialization or a required runtime operation failed.
- `unknown` means the adapter cannot verify the state; it must not infer
  `active` from configuration alone.

For `kind: userspace`, `active` means the required listeners and forwarding
workers are running with the active routing configuration and can handle
traffic. `degraded` means forwarding remains partially usable but a required
listener, worker, or observation is impaired. eBPF programs, hooks, and
publication are not prerequisites for a userspace-only datapath; `ebpf` is null.

For `kind: mock` or `ebpf.backend: mock`, states describe the simulated path
only. A mock may report `active` for verified simulated readiness, but this
does not claim real packet handling, kernel hooks, routing publication, or
host-traffic visibility. Unverified state remains `unknown`; clients must
not present mock readiness as a healthy production datapath.

This endpoint is read-only. Reload and lifecycle actions use
`/api/v1/operations/*`.

## Example

```bash
curl "http://localhost:9527/api/v1/datapath?detail=full"
```
