---
title: Probes
---

# POST /api/v1/probes

> Proposed bounded asynchronous probe resource. `/nodes` reads existing
> observations; it never probes. There is no separate check-nodes or
> node-latency action. A probe is not evidence that a client flow succeeded.

## Request

{% api_example createProbe request dns_udp http %}

| Field | Required | Contract |
|-------|----------|----------|
| target | yes | Exactly `{type: node, node_id}` or `{type: group, group_id}`. |
| kind | yes | `tcp_connect`, `http`, or `dns`; supported kinds are advertised. |
| purpose | yes | `data` or `dns`; the health domain being tested, not inferred from UDP alone. |
| transport | yes | Nonempty unique array of `tcp`/`udp`, restricted by kind. |
| ip_version | yes | `ipv4`, `ipv6`, or `any`. `any` expands to advertised families. |
| members | no | Group-only: `direct` (default), `leaves`, or nonempty unique direct-member IDs. |
| warmth | yes | `cold` or `warm`. An unimplementable reuse constraint returns 422, not mislabeled results. |

`tcp_connect` tests TCP reachability of the configured node server, not a
proxy handshake or application latency; it requires `transport: [tcp]` and
`purpose: data`. `http` tests the configured HTTP(S) check through the target
outbound, requires TCP/data, and measures through the response headers.
`dns` tests the configured DNS check through the target outbound and requires
`purpose: dns`; TCP and/or UDP describe that DNS query's transport. The IP
family refers to the check destination (node server for `tcp_connect`), not
necessarily the tunnel's network. There is no arbitrary UDP echo or generic
`latency` kind whose success criterion is unspecified.

A group `direct` target preserves direct members and policy-authorized nested
resolution; no eligible leaf produces `unavailable`, never an arbitrary
sibling. `leaves` is an explicit diagnostic expansion. Deduplicate identical
leaf/kind/transport/purpose/family/warmth executions while retaining every
member-to-leaf association in the results. `cold` excludes reusable check
connections; `warm` permits but does not require reuse. Result `warmth` states
what actually happened (`cold`, `warm`, or `unknown`). Do not claim a cold
physical tunnel merely because a new logical stream was opened.

The request cannot specify arbitrary URLs, names, IPs or ports. Use
administrator-configured check destinations, with the SSRF policy in
[Groups](groups.html): validate and pin resolved addresses, revalidate every
redirect, bound redirects/body/time, and do not let an API caller rewrite the
administrator allowlist. Invalid kind/transport/purpose combinations and
unsupported target capabilities return `422 unsupported_value` before work.

Probes may update native health and automatic selections. The adapter must
preserve native side-effect semantics and report `health_updated` per result
and `selection_changed` per transport. A reachability measurement MUST NOT be
injected into an application-latency collection as an equivalent sample.

## Accepted (202)

{% api_example createProbe 202 queued http %}

Poll [Operations](operations.html) or follow `operation.updated` events.

## Completed result

{% api_example getOperation 200 probe_complete %}

`succeeded` means the job completed, not that every target was healthy. Results
must cover every requested member and dimension combination. Unstarted or
cancelled work has `state: unknown`, a safe cancellation or deadline code, and
`health_updated: false`; it is not evidence of an unhealthy node.

## Limits

`resources.probes.limits` bounds fan-out, projected results, active/queued jobs,
per-target concurrency, deadline, and principal/global request rates. Reject
oversized fan-out/results with `413` before dispatch; use `429` for concurrency
or rate excess and the dedicated full-queue `503` response below. Both require
`Retry-After` as a positive number of seconds. Enforce one job deadline
including preparation; cancel and drain started work at expiry.
Already completed real errors keep their native health effects; cancellation
and never-started candidates are health-neutral.

### Full queue (503)

{% api_example createProbe 503 queue_full http %}
