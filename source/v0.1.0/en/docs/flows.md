---
title: Recorded Flows
---

# Recorded flows

> Proposed native API, not an existing honk endpoint. The target is full
> per-flow transparency: **rule input → dial mode → IP/DNS → reroute? →
> outbound → connection status**. This is a causal chain, not a mandated
> execution order: DNS may run before a rule, during domain verification,
> or inside an outbound dial. Record the order the engine actually executed.

A flow is one engine-observed TCP connection incarnation or UDP session
incarnation, including attempts that are blocked or fail before a connection
exists. `/connections` is the live connection view; it cannot substitute for
this retained decision record. Reading a flow MUST NOT re-evaluate rules,
resolve DNS, probe nodes, or dial anything.

## Identity and lifetime

- `id` is an opaque, instance-scoped flow ID, allocated at the first decision
  hook, before sniffing, DNS, or dialing can fail. Together with `instance_id`
  it is never reused. Neither a five-tuple, PID, socket cookie, outbound index,
  nor honk's UDP decision token alone is an API identity.
- Kernel and userspace observations join only through an incarnation-safe
  handoff. If correlation cannot be proved, return separate partial records;
  never join by IP, name, five-tuple, or a nearby timestamp alone.
- `connection_id` is nullable: blocked, failed, and kernel-direct flows may
  never have a userspace tracker entry. One UDP endpoint may carry several
  packets; a retired/recreated session gets a new flow ID.
- `generation_id` on a step names the configuration/routing generation
  actually used at that step. A flow can cross reload generations. Do not
  relabel old steps with the current generation, group name, or selected leaf.
  `rule_id` is meaningful only with that generation and rule chain.
- A new engine process gets a new `instance_id`. API IDs are not BPF map ABI;
  do not change the persisted UDP token allocator to implement them.

## GET /api/v1/flows

Requires `observe`. Returns active **and retained terminal** flows.

| Parameter | Default | Meaning |
|-----------|---------|---------|
| network | all | `tcp`, `udp`, or `all`. |
| state | all | One lifecycle state below, or `all`. |
| connection_id | absent | Exact opaque connection ID within the current adapter instance; includes retained terminal flows, never tuple matching. |
| limit | 100 | 1–1000, additionally bounded by the advertised limit. |
| cursor | absent | Opaque snapshot cursor; includes the original filters. |
| detail | summary | `full` adds source/destination/domain inputs; not the trace. |

{% api_example listFlows 200 visible %}

`revision` increases whenever the retained flow changes. Cursors preserve a
bounded point-in-time list, ordered newest-first with ID as tie-breaker. An
expired snapshot returns `410 snapshot_expired`; do not silently restart a
page walk. `pname` is the captured process name or `null`, including for LAN
traffic without process context. It is available in summary; summary is a
payload-size tier, **not an authorization or privacy boundary**.

Use `connection_id` to find retained traces after a connection leaves the
live snapshot. Correlate IDs only within the same `instance_id`; a restart
does not authorize a tuple-based fallback.

### List-view fields

`Connection` and `FlowSummary` carry the same required list-view evidence,
including with `detail=summary`; no per-row trace fetch is needed for these
columns. Nullable fields remain present when unavailable.

| Field | Type | Description |
|-------|------|-------------|
| chain | array of strings | Application outbound `selection_path` group IDs followed by the leaf node ID, in order; empty for direct/block or an unknown path. |
| chain_source | string | `evaluation`: captured at selection; `reconstructed`: recovered from retained evidence; `unknown`: unavailable. |
| rule_id | string or null | Generation-scoped traffic rule ID, or null when unavailable. |
| rule_expression | string or null | Sanitized display expression for that rule, or null when unavailable. |
| rule_source | string | `kernel`: deciding kernel rule; `recomputed`: userspace recomputation, not the deciding kernel rule; `unknown`: unavailable provenance. |
| ingress | string or null | `lan` or `wan` when captured; null when unavailable. |
| domain_source | string or null | `tls_sni`, `http_host`, `quic_sni`, `dns_mapping`, `explicit`, or `unknown`; null without domain evidence. |

`chain` describes the effective application selection, not an interleaved
DNS lookup or a transport retry. Use an empty chain with `chain_source:
unknown` when the path was not captured; an empty chain alone does not prove
direct/block. Never join today's group registry to claim an old selection.
The source label describes evidence, not the outbound step's `routing_source`.

The [honk `matched_rule` row](honk-mapping.html#matched-rule) distinguishes
the deciding kernel rule from recomputed userspace evidence. Preserve that
distinction in `rule_source`; GET must not re-run routing to populate it.
`rule_expression` is display text, never executable configuration.
Rule IDs retain their generation and traffic-chain scope; use the detail
trace for that context rather than merging identical IDs across reloads.
These columns do not upgrade a partial trace to complete.

### Full inputs

`detail=full` adds an `input` object with `src`, `dst`, `domain`, `domain_source`,
`pid`, `process_path`, `src_mac`, `ingress`, `domain_rule_ids`, `dscp`, and
`mark`; each is nullable. `ingress` is `lan` or `wan` when known;
`domain_rule_ids` is the consumed domain-predicate ID set when routing used
an IP bitmap rather than a known domain. Addresses use
`ip:port` or `[ipv6]:port`. `dst` is the original destination, never the proxy
server. `domain_source` is `tls_sni`, `http_host`, `quic_sni`, `dns_mapping`,
`explicit`, or `unknown`. A DNS IP-to-domain association is not proof of what
name this client requested. PID/path are optional observations, not inferred
from a later lookup of a reused PID. All full fields require the same
`observe` permission and MUST be sanitized; packet bodies and credentials
are never returned.

## GET /api/v1/flows/{flow_id}

Requires `observe`. Returns the full flow summary, `input`, and `trace`.
There is no second trace ID or independent trace store to correlate.

{% api_example getFlow 200 partial_handoff %}

This example records the kernel's handed-off decision, **not its unrecorded
rule path**; it is intentionally partial. It also illustrates domain dialing
without locally resolving the destination. Do not manufacture an IP or DNS
step when the remote proxy resolves the name.

## Step contract

Every step has `seq` (positive integer, strictly increasing within the flow),
`stage`, `observed_at` (RFC3339 or null), `elapsed_us` (monotonic offset from
first observation or null), `generation_id` (string or null), `evidence`
(`observed` or `reconstructed`), and the stage-specific `data` below. Sequence
is collector order, not proof of causality between concurrent attempts;
`attempt_id` and evaluation references carry that relationship. Sequence,
flow revisions and monotonic offsets are bounded JSON integers in
0–9007199254740991; cumulative `uint64` counters use decimal strings instead.

| stage | data contract |
|-------|---------------|
| `input` | Client-flow observation changes: `values` uses the display `input` fields plus nullable `pname`; `source` is `kernel`, `socket`, `sniffer`, or `dns_mapping`. This event does not implicitly supply a later route's inputs. |
| `route` | `evaluation_id`, `chain` (`traffic`, `dns_request`, `dns_response`, `dns_upstream`), `plane` (`kernel`, `userspace`), immutable chain-specific `input` (or null for missing capture), nullable `dns_action`, nullable `rule_id`, `rules` (below), nullable `outbound`, nullable `must`, nullable `mark`. One record per actual evaluation/pass. |
| `datapath` | `plane` (`kernel`, `userspace`), `action` (`pass`, `redirect`, `hold`, `arm_direct`, `activate_direct`, `activate_proxy`, `drop`), safe `reason`, nullable `error`. Record enforcement separately from the policy verdict. |
| `dial_mode` | `configured` (engine-native mode), `effective_target` (`ip`, `domain`, `none`, `unknown`), nullable `domain` and `domain_source`, `verification` (`matched`, `other_family_trusted`, `failed`, `not_required`, `unavailable`), safe `reason`. Rejected SNI remains evidence here, not an accepted routing input. Other-family trust is not an exact IP match. |
| `dns` | `lookup_id`, nullable `parent_lookup_id`, nullable `attempt_id`, `purpose` (`domain_verification`, `dial_target`, `proxy_server`, `intercepted_query`, `family_preference`, `refresh`), `name`, `qtype`, `source` (`hosts`, `cache`, `upstream`, `coalesced`, `unknown`), nullable `upstream_transport` (`udp`, `tcp`, `dot`, `doh`, `doq`, `doh3`), nullable `carrier_transport` (`tcp`, `udp`), `cache` (`hit`, `miss`, `stale`, `bypass`, `unknown`), nullable `cache_entry_id`, nullable `upstream`, `route_evaluation_ids`, `status`, `addresses`, nullable `selected_ip`, nullable `error`. One step per question/result; include failed and rejected response attempts. |
| `reroute` | `performed` (bool or null), safe `reason`, nullable `from_evaluation_id` and `to_evaluation_id`. `false` means deliberately not rerouted; `null` means not observed. Examples: final must/block, preserved IP route, verified domain, missing domain. |
| `outbound` | `attempt_id`, nullable `parent_attempt_id`, `kind` (`leaf`, `transport`), nullable `evaluation_id`, `routing_source` (`evaluation`, `forced`, `builtin`, `unknown`), nullable `routed_outbound` and `effective_outbound`, `mode_override` (`none`, `direct`, `global`, `unknown`), ordered `selection_path`, nullable `leaf_node_id` and `leaf_node_name`, nullable `target`, `target_kind` (`ip`, `domain`, `none`, `unknown`), nullable `dial_ip`, nullable `server_addr`, `resolution_location` (`original_ip`, `local_dns`, `outbound_remote`, `not_applicable`, `unknown`), `status` (`started`, `succeeded`, `failed`, `cancelled`), nullable safe `error`. Emit attempt transitions, including failed/cancelled losers, without changing old steps. |
| `connection` | `state`, safe `reason`, `milestone` (`transport_ready`, `target_request_sent`, `target_confirmed`, `first_reply`, `terminal`, `unknown`), nullable `attempt_id`, nullable `reply_received`, nullable safe `error`. Includes failures before registration and terminal cleanup. |

Each selection-path item also has nullable `member_name` and `selection`.
`selection` is a decision-time object with nullable `previous_member_id`,
`metric`, `tolerance_ms`, and a `candidates` array. Each candidate requires `member_id`, `selected` (boolean), and safe
`reason`; its required nullable fields are `member_name`, `leaf_node_id`,
`leaf_node_name`, `eligible`, `sorting_latency_ms`, and `score`. Preserve the actual considered
candidates and eligibility/demotion/exploration reasons, not every configured
node. Manual selection can use null; an automatic decision whose context
was not captured makes the trace partial. These values come from the actual
selection computation, not a later `/groups` snapshot. An unstarted candidate
can be considered for selection without becoming a dial attempt.
Path `member_id` is nullable when an empty/ineligible group has no selected
member. Preserve that group and its failure/final-fallback reason. A final
group adds another path item; a builtin/node terminal uses the outbound/leaf
fields, not a fabricated declared group member.
Names are sanitized decision-time captures, required but null when
unavailable. IDs remain authoritative; never replace a retained name by
joining the current node or group registry.

DNS `addresses` is the observed IP answer set, not the list of addresses
actually dialed. A proxy server IP is not the flow's destination IP. Shared
DNS/singleflight work can use the same `lookup_id` in multiple flows; a cache
hit references the consumed cache entry only when its identity is known.
Never retroactively attach an unrelated later DNS query to a flow.

`parent_lookup_id` links a real family-preference/helper/refresh operation
to its trigger, not to a guessed client transaction. A stale response can
have a failed fresh attempt; distinguish answer source from attempted
upstream. `upstream_transport` is configured DNS protocol, while
`carrier_transport` is what actually carried the exchange (for example,
configured UDP DNS carried over TCP through a proxy).

A kernel `drop` used to complete proxy handoff is not a policy `block`.
Likewise direct activation ends userspace setup, not the native connection.
Record NFQUEUE hold/arm/verdict/publication order in `datapath` steps without
exposing mutable verdict tokens. Static port-53 interception and early
bypasses are enforcement reasons, not invented configured rule matches.

`server_addr` is the physical proxy server/socket peer if observed; `dial_ip`
is the destination chosen for the application target. They may differ or be
unknown. Internal address races/session retries are `transport` attempts
under their owning `leaf` attempt, not invented alternative group selections.
Speculative pool warming/probes are not client-flow attempts merely because
they dial the same node. Reused transports must not claim a new handshake.

### Inputs belong to an evaluation

`route.data.input` is the immutable input **consumed by that evaluation**,
not a reference to the most recent client `input` event. Its shape follows
`chain`; the client flow's display tuple and `network` remain unchanged:

| Chain | Required input fields |
|-------|-----------------------|
| `traffic`, `dns_upstream` | `network` (`tcp` or `udp`), nullable `src_ip`, `src_port`, `dst_ip`, `dst_port`, `domain`, `pname`, `src_mac`, `dscp`, `mark`, `ingress`, `domain_rule_ids`. IPs are literals, ports are 0–65535; zero preserves internal resolver source ports. |
| `dns_request` | `name`, `qtype`, nullable `source_ip` and `original_dst` (`ip:port` or `[ipv6]:port`). The original DNS destination is needed by `asis`. |
| `dns_response` | `name`, `qtype`, `answer_ips` (the consumed address list), `from_upstream`. These are the response being evaluated, before any requery replaces it. |

All listed keys are present in a captured input. A nullable field denotes an
observed absent value; missing capture uses `input: null` and a partial trace,
never a fabricated zero/empty context. In particular, a TCP client flow can
contain a DNS-upstream evaluation of
`0.0.0.0:0 → 192.0.2.53:53 / udp`, with no process or MAC context.
The evaluation's transport is the router input, not necessarily the DNS
carrier after proxy conversion; do not derive it from the top-level flow.

For traffic/DNS-upstream evaluations, `dns_action` is null and `outbound` is
the router's outbound. For DNS request rules, `dns_action` is `upstream`,
`asis`, or `reject`; for response rules it is `accept`, `reject`, or `requery`.
`outbound` then names the selected upstream only for `upstream`/`requery`,
and is null otherwise; `must` and `mark` are null for these DNS-policy chains.
Unknown DNS action is null and makes the trace partial. An upstream named
`accept` is therefore distinguishable from the accept action.

### Causal references, not adjacency

`evaluation_id` identifies exactly one route evaluation within this flow.
An outbound with `routing_source: evaluation` references the evaluation that
caused the attempt; the reference is non-null even if another evaluation
selected the same outbound. Forced/builtin choices have a null reference
because no router ran for that choice; `unknown` means missing evidence and
requires a partial trace. Internal transport attempts retain the owning
evaluation reference and use `parent_attempt_id` for their leaf attempt.

Evaluation IDs are unique; repeated attempt IDs describe transitions of the
same attempt, never another attempt. A complete trace resolves every
evaluation, attempt-parent, DNS route/attempt, and reroute reference to the
corresponding records in that flow; parent links cannot cycle. A partial
trace may retain references whose evidence was lost, but must label the loss
and must not substitute another record with a matching name or address.

For example, two DNS families may complete out of order:

| Collector order | Record | Recorded input / causal edge |
|-----------------|--------|------------------------------|
| 1 | traffic evaluation `app-1` | Client TCP tuple; its own immutable input. |
| 2 | request evaluation `request-a` | `name: example.com`, `qtype: A`, client source. |
| 3 | request evaluation `request-aaaa` | Same name/source, `qtype: AAAA`; not an update to `request-a`. |
| 4 | upstream evaluation `up-a` | Resolver IPv4 tuple and router transport `udp`. |
| 5 | upstream evaluation `up-aaaa` | Resolver IPv6 tuple and router transport `udp`. |
| 6 | outbound attempt `dial-aaaa` | `evaluation_id: up-aaaa`; completing first changes no other edge. |
| 7 | response evaluation `response-aaaa` | AAAA response address list and actual `from_upstream`; action `accept` or `requery`. |
| 8 | DNS result `lookup-aaaa` | `attempt_id: dial-aaaa`, `route_evaluation_ids: [request-aaaa, up-aaaa, response-aaaa]`. |
| 9 | outbound attempt `dial-a` | `evaluation_id: up-a`, regardless of the most recent route record. |

An application's later outbound references its own deciding traffic
evaluation, not the most recently completed DNS evaluation. Following
`requery` performs and records new evaluations/attempts; it never overwrites
the earlier response input. Reads do not reconstruct any of these edges.

### Rule evaluations

Each `rules[]` item has `rule_id`, nullable `expression`, `result`,
`missing_inputs`, and `conditions`. Each condition has `id`, nullable
`expression`, `result`, and `missing_inputs`; IDs identify nodes in the
compiled predicate tree (including AND/OR/negation), not flattened
independent booleans. `expression` is a sanitized display of that rule or
predicate, including its configured operands; it is not a second executable
rule language. Keep the generation's rule dictionary while records refer to
it, and expand compact IDs at serialization, not on the packet path.
Compiler-inserted rules use a distinct namespace. Never expose raw config or
credentials through expressions; redacted required evidence marks a trace
partial. Consumed bitmap predicate IDs are valid recorded inputs even when
the client's domain string was never observable.

`result` is `matched`, `not_matched`, `skipped`, or `indeterminate`. `skipped`
means not executed after a final rule or short-circuit; it is not a negative
verdict. `indeterminate` means evidence/input is missing, not a guessed
non-match. `missing_inputs` lists names such as `dst_ip`, `pname`, or
`kernel_rule_trace`. A result with missing evidence MUST NOT be upgraded to
`observed` by replaying today's router. A replay can be attached only as a
`reconstructed` step, and cannot fill a completeness gap.

A full trace captures the inputs each rule consumed inside its own route
record, the actual short-circuit path and deciding rule/fallback. Empty
`rules` plus an outbound is useful partial evidence, not full rule tracing.
An input absent at runtime is different from an input absent in the recorder:
record the engine's real absent-value evaluation in the former case.

### Connection states

`observed → routing → dialing → active → closed` is a common TCP path, not a
required sequence. `blocked` and `failed` can occur before `dialing` or
`active`; a kernel-direct decision need not dial. All terminal states are
`closed`, `blocked`, or `failed`. `unknown` is observational uncertainty, not
an engine verdict; a later observation may resolve it.

For TCP, `active` and outbound attempt `succeeded` mean a usable local stream
was returned, not necessarily that the remote proxy accepted the target.
Some protocols defer their target request/response until first I/O.
`milestone` distinguishes transport readiness, request transmission, actual
target confirmation (only when the protocol provides it), and first reply.
Never infer `target_confirmed` from tracker registration or a completed QUIC
connection to the proxy server.

For UDP, `active` means the local endpoint/transport is usable, not that the
remote application responded. Record first reply with `reply_received: true`;
idle expiry, no-reply expiry, transport death, intentional retirement, and
shutdown have distinct safe `reason` codes. A health-neutral cancellation is
not an outbound failure. LRU/map eviction or lost observation is not a clean
TCP FIN and MUST NOT be fabricated as `closed`.

## Completeness, retention, and cost

`trace.status` and `trace_status` agree: `complete` means every decision so far
in the declared flow scope was captured with observed evidence; `partial`
means evidence is missing; `disabled` means recording was off. Complete does
not imply terminal or successful. `trace.missing` is empty only for complete
traces; otherwise it lists `not_instrumented`, `started_late`, `buffer_overflow`,
`sampled`, `redacted`, or `evicted`. No applicable DNS/reroute/dial work is a
recorded not-applicable decision, not missing evidence.

List `coverage` reports each observation scope as `full`, `partial`, or `none`,
independently of individual trace completeness. It is bounded to managed
interfaces/ingress and the advertised recording interval, not all host
packets. `dropped_records` is a canonical unsigned 64-bit decimal string
counting losses since this instance started, or null when unavailable;
`"0"` must be measured. Sampling or loss downgrades coverage.
Unobserved kernel-direct/blocked flows cannot be hidden behind a full
userspace list. Kernel bypasses (multicast, own traffic, local services, closed
admission) must be declared even where no connection exists.

Capabilities advertise `recording` (`off`, `on`, `sampled`), `scopes`,
`max_flows`, `max_steps_per_flow`, `retention_seconds`, `snapshot_ttl_seconds`,
and `max_page_size`. Retention is a **maximum age after termination**, not a
durable guarantee under the bounded memory limit. Eviction, recording toggles,
and losses produce `flow.gap` events; per-flow loss also marks the retained
record partial. Known expired IDs return `410 flow_expired` while a bounded
tombstone exists; otherwise unknown/unauthorized IDs return `404 flow_not_found`.


All snapshots, rule dictionaries and variable-length step data share bounded
recorder memory. Admission to a new snapshot may return `503` rather than
allocate without limit; oversized candidate/rule evidence marks the trace
partial. Neither longer retention nor pagination permits unbounded metadata.
Do not stream packets, format rule strings, walk all maps on each GET, or make
forwarding await a dashboard. Capture compact decision IDs into bounded
buffers at existing decision boundaries; serialize on the control plane.
The full-transparency profile requires the missing decision hooks, not a
slower approximation that re-executes routing during a read.

## Acceptance scenarios

An implementation claiming full transparency MUST demonstrate actual records
for: TCP dial failure before tracker insertion; UDP no-reply expiry versus
reply-then-idle; kernel direct and block; must/block resisting mode override;
each supported dial mode; accepted and rejected domain verification; DNS hit,
stale hit, upstream failure and remote name resolution; nested group selection
and cancelled/retried dials; interleaved A/AAAA evaluation/attempt references;
TCP application versus UDP resolver inputs; DNS response-policy requery;
reload between steps; five-tuple reuse; buffer loss, eviction, and an SSE
reconnect gap. Simulation output alone proves none
of these runtime observations.
