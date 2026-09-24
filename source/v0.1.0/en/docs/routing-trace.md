---
title: Routing Simulation
---

# POST /api/v1/routing/trace

This endpoint simulates routing for hypothetical input. It does not report a live
flow's history; use [Recorded Flows](flows.html) for observed decisions.

Use a JSON body rather than GET query parameters: process/domain/source inputs
should not be copied into access-log URLs, and live DNS must be explicit.
Requires `control` because `resolve: live` can create DNS traffic. Neither
mode dials the hypothetical flow, alters routing, updates node health,
changes group selection, or publishes domain bitmaps to the datapath.

{% api_example traceRouting request hypothetical http %}

`input.network` (`tcp` or `udp`) and `dst_port` (1–65535) are required. At
least `domain` or `dst_ip` is required. Other input fields are optional and
nullable; missing source IP/port, process name, DSCP, and mark are **unknown**,
not empty strings, zero, or the API caller's own metadata. IPs must be literal
IPv4/IPv6; DSCP is 0–63, mark 0–4294967295, and source port 1–65535. Domain
validation uses the DNS query limits. Unknown fields return `400 invalid_request`.
The supplied domain is explicit input, not a claim that SNI verification passed.

`resolve` is `none` (default) or `live`. With `none`, do not resolve even from
cache; a supplied destination IP yields exactly one evaluation, while a
name-only input yields one evaluation with `dst_ip: null`. With `live`, require
a domain and no destination IP; use the engine's own DNS routing chain and
produce one evaluation per unique A/AAAA address. Do not synthesize a routing
outbound if DNS fails or returns no addresses: return an empty `evaluations`
array and the actual DNS results. DNS is the only permitted network activity.
Use an isolated, non-publishing query context: it may read existing cache
entries but must not fill/refresh/invalidate runtime caches, health, selection,
or domain-routing maps. An engine unable to isolate this must not advertise
`live` resolution; its regular state-mutating resolver is not a dry-run API.

{% api_example traceRouting 200 indeterminate %}

The example's later match is conditional on the earlier unknown rule not
matching. It does **not** authorize returning that later outbound as certain.
`decision` is `determinate` or `indeterminate`; `outbound` is non-null only
when all feasible paths agree on it. A deciding fallback is a rule with its
own generation-scoped ID. `rules` uses the recorded-flow rule/condition
contract, with `skipped` for actual short-circuiting. Unknowns propagate
through AND/OR/negation; a missing input irrelevant to a proven decision need
not make the result indeterminate. Do not convert `indeterminate` to a miss
and continue as though every input were known.

[GET /rules](rules.html) uses these same `rule_id` values for the same
`generation_id`, including fallback. It lists the running dictionary without
evaluating inputs; do not join a trace to a different generation's dictionary.

`dns` contains the same data objects as recorded `dns` steps, with
`purpose: dial_target`; their lookup IDs are simulation-only and never link
this request to a live flow. A `200` response can contain DNS errors or
indeterminate evaluations; these are diagnostic results, not HTTP failures.

Pin the router, assets, DNS policy, and any consulted selection state for the
request. `generation_id` is the pinned routing generation, not the current
generation at response serialization. If the adapter cannot obtain a
consistent snapshot, return `409 snapshot_unavailable`, rather than combine
old rules with new group IDs. Automatic policy state is still time-dependent:
the result predicts a **rule outbound**, not a future dial, remote IP, leaf
node, reroute, connection success, or actual kernel short-circuit path.

Capabilities under `routing_trace` advertise `resolve_modes`, `max_addresses`,
`max_rule_steps`, `timeout_ms`, and per-principal/global requests per minute.
Enforce limits before fan-out, stop at the common deadline, and reject a
result exceeding address/rule bounds with `413 request_too_large` instead
of truncating into a determinate answer. Timeout returns `503` with
`Retry-After`; rate excess returns `429`. Incompatible input/resolve mode or
unadvertised modes return `422 unsupported_value`.
