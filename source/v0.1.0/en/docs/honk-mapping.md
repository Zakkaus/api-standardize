---
title: honk Implementation Evidence
---

# Design decisions and honk implementation evidence

This revision responds to [PR #1's discussion](https://github.com/daeuniverse/api-standardize/pull/1)
and the [routing-trace proposal](https://github.com/daeuniverse/api-standardize/pull/2).
The objective is **full per-flow transparency**, not merely a richer connection
list. The native endpoints remain proposed; this repository does not implement
them in honk or dae.

Source inspection used the local honk checkout at HEAD
`780c3f158bbe6e69c02327d5e7ce46d1b594cf4e`. Links below pin that revision rather
than drifting with `main`. This is source evidence, not a real-kernel runtime
verification. No dae source checkout was audited, so honk-specific behavior
must not be advertised as a shared dae guarantee.

## Disposition of PR #1 comments

| Comment | Decision |
|---------|----------|
| Node subscription provenance | Add nullable `subscription_tag`, using current subscription name via node provenance, never name heuristics or credential-bearing URLs. |
| Health averages and ranking | Define last real sample, real-only halving average and real-only last-ten average; add purpose/warmth/measurement/source and group-context effective ranking. Unsupported formulas stay null. Tolerance is hysteresis, not an offset. |
| Process attribution | Add nullable `pname` to connection/flow summaries. Summary is a size tier, not a privacy permission. Delayed process-path lookup is not durable process identity. |
| JSON versus GraphQL | Keep native HTTP JSON, HTTP status/preconditions and operation envelopes. No second query language. |
| Separate panel, embedded deployment | Keep API independent of asset packaging. An embedded/static UI and LuCI can share it; preserve Clash compatibility rather than replace it. No UI repository/build pipeline is added here. |
| Machine-readable contract | Resource-owned OpenAPI sources publish one generated bundle; native named examples also render the documentation snippets. Standard schema/example validation and focused header, framing and flow-invariant tests replace reverse-parsing Markdown; semantic narrative remains hand-authored. |
| Streaming | Bounded invalidation SSE with resume, authorization, loss and resnapshot rules. Flow details remain GET resources, not duplicated into every event; engine logs use a separate feed. |
| Version path | `/api/v1` for resources, `/api` for discovery; document revision and engine version are independent. No unversioned resource aliases. |
| Raw config and validation | Correct the claim about current `/configs`; defer native editing/readback until source ownership, credential privilege, includes and revision semantics are designed. Do not expose raw secrets under `observe`. |
| Probe overlap | One `/probes` resource, explicit `tcp_connect`/`http`/`dns` semantics and health dimensions; `/nodes` is read-only. |
| Required capabilities | Define `base` and `full_transparency` profiles. Userspace-only snapshots cannot claim the latter. |
| `202 Retry-After` | Mandatory alongside Location; clients obey a positive-seconds polling floor, including after an SSE invalidation. |
| Group override | Automatic policies (urltest, fallback, loadbalance, random, score) accept a pinned member per transport; the pin lives beside the policy's own pick, is reported as `source: override`, and is dropped on activation. Selector groups keep `can_select` only. | `can_override` is per group; the engine decides which policies can be pinned. |
| Connection/flow list columns | Denormalise the application chain, rule ID/expression, ingress and domain provenance onto both summaries. Current handoff/tracking omits deciding-rule context; producers must retain selection IDs and label evaluation, reconstruction and recomputation honestly. |
| Per-outbound usage | Add `/runtime/outbounds`, mirroring the current Clash `/stats` counters. Producers must retain outbound kind and a shared reset timestamp, and serialize full-width counters without the current snapshot's uint32 narrowing. |
| Traffic history | Add `/runtime/traffic/history` with advertised window/point ceilings. Current Clash traffic streaming supplies live rate deltas, not timestamped queryable history; producers must sample into a bounded ring independently of subscribers and preserve gaps/reset boundaries. |
<<<<<<< HEAD
| Memory history | Add `/runtime/memory/history` on the same ring design: sample the advertised `runtime_memory` metrics on a fixed cadence, keep age/capacity eviction and restart clearing, and enforce the advertised limits before reading. |
| Connection closing | Add single and filtered bulk DELETE actions under `control`, gated by `connections.can_close`. Close userspace-owned transports/sessions, not tracker entries; skip non-closable bulk matches. Require `all=true` for an unfiltered bulk close and enforce `max_bulk_close` before cancellation. |
=======
| Engine logs | Add read-only `/logs` SSE with typed, sanitized records, minimum-level/module-prefix filters and bounded cursor replay. Logs are not recorded-flow evidence; redact before buffering rather than forwarding raw engine output. |
| DNS log | `GET /dns/log`: record each client resolution (question, source, upstream or cache, answers, routing decision, elapsed) into a bounded ring in the DNS layer; filters and cursor paging over the ring. |
| Runtime settings | `GET`/`PATCH /runtime/settings`: one place for the tracing filter level, the log and DNS log ring capacities and flow retention; a PATCH reloads the filter handle and resizes the rings at runtime without writing the configuration file. Ceilings are the capability values. |
| Providers | Add paginated provider metadata, optional `Node.provider_id`, and a control-only refresh operation. Preserve native subscription/file/inline provenance, redact source URLs, and keep provider usage separate from runtime counters. These rows define the proposed contract, not verified current endpoints. |
| Running rules | Add a read-only generation-scoped dictionary with the same rule IDs as routing simulation and flow summaries. Retain fallback identity, redact source paths, and refetch on generation publication; no rule-editing or raw-config endpoint. |
>>>>>>> observability-endpoints

## What the current code actually retains

| Area | Existing source evidence | Consequence for this API |
|------|--------------------------|--------------------------|
| Kernel route | [RoutingInput/Decision](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-ebpf-common/src/routing_policy.rs#L12-L68) contains normalized tuple, MAC, pname, DSCP, ingress context, rule ordinal and verdict. [Descriptor](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-ebpf-common/src/routing_policy.rs#L101-L109) has a real publication generation. | Capture these at evaluation. Rule ordinal alone is not stable identity. |
| Handoff | [HandoffResult](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/control/connection/handoff.rs#L42-L66) omits rule and generation; kernel callers project the decision into forwarding metadata. | Today's handoff cannot reconstruct the old rule path. Keep a generation-scoped rule/outbound dictionary at the producer. API GETs must not consume a routing handoff map. |
| <a id="matched-rule"></a>`matched_rule` | [prepare_routing](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/control/connection/routing.rs#L190-L269) may run the current userspace router for tracking while preserving the kernel's actual outbound/mark/must. | A rule string on a connection can be recomputed evidence, not the deciding kernel rule. Label reconstruction and never upgrade it to a complete trace. |
| TCP tracking | [TCP registration](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/control/connection/tcp.rs#L304-L446) occurs after successful candidate dialing. | Create the observation ID earlier; retain blocked/empty-plan/dial-failed outcomes that never become connections. |
| UDP tracking | [UDP initialization](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/control/connection/udp.rs#L499-L603) registers after transport preparation but before ready publication and first-send acknowledgement. | Transport prepared, first send accepted and first reply are different milestones. Track endpoint incarnations, not individual packets. |
| <a id="tracker-deletion"></a>Tracker deletion | [ConnectionTracker::remove](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/connection_tracker.rs#L129-L172) erases a map entry. [Clash DELETE](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/clash_api.rs#L1259-L1268) calls that method. | Disappearance is not proof of transport cancellation. Native closing must cancel an owned TCP transport or retire an owned UDP session before reporting success; keep `can_close: false` until this is implemented. |
| Close ownership and events | The TCP/UDP tracking and kernel-plane evidence above distinguish owned transports from observations; an outbound name does not establish ownership. | `observed_by` is not a close capability. Return `409 state_conflict` for observed kernel-direct/bypassed connections, or count them as `skipped` in bulk. Record terminal state and emit existing `flow.updated` invalidations when advertised; use `runtime.updated` for runtime-counter changes, without adding an event kind. |
| Deferred protocol setup | [Hysteria2 stream](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-outbound/src/proxy/hysteria2/mod.rs#L226-L278) can return before its buffered target request is sent/accepted. | `active` is not automatically remote-target-confirmed. |
| DNS provenance | [DnsOutcome](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/dns/outcome.rs#L63-L93) has transient outcome/upstream metadata; [ResolvedAddr](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/dns/resolver.rs#L13-L18) retains addresses/TTL, not flow correlation. | Add lookup references at consumers, not by matching DNS transaction IDs or nearby names/IPs. |
| Native health | [URLTest ranking](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-outbound/src/group/policy.rs#L300-L387) uses a real-only EMA plus a separate failure-demotion tier; [parser aliases](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-config/src/parser/groups.rs#L161-L190) map `min_avg10` and `min_last_delay` to URLTest too. | Do not choose a displayed ranking metric from the raw policy spelling, or turn a demotion tier into invented milliseconds. |
| Configuration | [GET/PUT /configs](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/clash_api.rs#L332-L355) returns compatibility settings/metadata diagnostics; PUT is a no-op. | There is no existing raw-text readback or candidate-validation HTTP contract to standardize by renaming. |
| List-view evidence | Kernel route inputs retain ingress; selection has group/leaf context, but the handoff and `matched_rule` evidence above do not preserve a complete deciding path. | Capture application selection IDs, generation-scoped rule ID/expression and domain source at their producer boundaries. Reuse them in `Connection` and `FlowSummary`; do not recompute on GET or join the current registry. |
| <a id="outbound-counters"></a>Outbound counters | [Clash `/stats`](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/clash_api.rs#L859-L907) exposes name, total/active connections, upload/download and errors. [OutboundTracker](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/stats.rs#L13-L67) retains uint64 atomics but narrows connection/error snapshots to uint32. | Read full-width producer counters for the native resource; capture kind and shared `counter_since`, preserve closed-connection totals and original attribution, and do not infer kernel-wide coverage. |
| Traffic history | [Clash traffic sampler](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/clash_api.rs#L1319-L1350) broadcasts live byte deltas while subscribers exist, without sample timestamps or a history query. | Add periodic timestamped rate/connection capture into a bounded ring, with age/capacity eviction, reset-aware gaps and restart clearing. Enforce advertised window/point limits before reading it; SSE replay remains separate. |

## Dial mode is not Clash mode

The four configured dial modes have different rule-input and target effects.
The following describes **honk's current intercepted-flow path**, not a rule
that other engines must emulate:

| Dial mode | Sniff/verification | Domain in routing | Proxy target |
|-----------|--------------------|-------------------|--------------|
| `ip` | Skip sniff. | No sniffed domain. | Original IP. |
| `domain` | Resolve sniffed name; accept exact original-IP match or trust other-family-only answers; otherwise discard. | Accepted domain, only where handoff finality permits. | Accepted domain, otherwise original IP. |
| `domain+` | Retain sniffed name without reality verification. | Preserve IP-only routing input/eligible initial handoff. | Domain when available. |
| `domain++` | Retain sniffed name without reality verification. | Domain participates where eligible; not an unconditional reroute. | Domain when available. |

[Verification and reroute gates](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/control/connection/routing.rs#L53-L177)
exclude `must` and reserved handoffs from sniff replacement. Control-plane
routing already delegates the evaluation; it is not a second reroute merely
because userspace runs. `domain`'s other-family trust must be distinguished
from an exact IP match; the current bool loses that distinction.

[Clash mode override](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/control/connection/handoff.rs#L450-L475)
is a later, separate choice. `must` and `block` resist it; a non-must direct
result may still change under Global mode. Direct outbounds use the original
IP even if a domain was sniffed. A fixed routed group does not freeze its
selected leaf or prohibit that group's configured final fallback.

## Boundaries the full-transparency implementation must cover

### Kernel versus userspace

[LAN ingress](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-ebpf/src/ingress.rs#L473-L910)
contains closed-admission, special-address, cached-decision, local-socket,
static port-53, direct-offload and staging paths. [WAN](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-ebpf/src/egress.rs#L353-L547)
can enforce direct and block without a userspace connection. LAN block may
instead be redirected for userspace enforcement. Outbound name alone cannot
identify the enforcement plane or whether a packet was delivered.

[NFQUEUE transitions](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/control/nfqueue/transition.rs#L4-L250)
require direct arm → marked accept verdicts → direct activation; proxy
publication happens before canonical dialing/sending, and the held originals
are dropped as part of that handoff. An NF_DROP is therefore not necessarily
a routing block. Observability must not alter this safety ordering.

The existing [event consumer](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/ebpf/real/events.rs#L18-L96)
feeds rate-limited logs, not retained per-flow events. The kernel producers
in `honk-ebpf/src/contrack.rs` emit overflow/token-exhaustion diagnostics;
the `Blocked` enum variant alone is not evidence of block-event coverage.
Add producer loss accounting and bounded retention. Do not infer completeness
from a quiet log, map occupancy, or an attached program.

### DNS, addresses, and groups

[DNS pipeline](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/dns/engine/pipeline.rs#L165-L269)
handles hosts before request routing, then cache/singleflight/upstream work.
[Cache outcomes](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/dns/engine/pipeline/cache.rs#L12-L99)
do not retain the original upstream history. Request route, response requery,
resolver-server route, family-preference helper, refresh and application
reroute are separate decisions. A domain passed to a remote proxy need not
have a locally known selected destination IP.

[DNS upstream routing](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/dns/upstream_pool/routing.rs#L20-L46)
can carry configured UDP DNS over TCP through a proxy. Record the actual
carrier and leaf instead of copying the client's UDP label. Health has TCP,
DNS-UDP and data-UDP domains; existing probe histories also mix warm-up,
restored and derived samples. New API labels must be captured at production,
not reconstructed as independent measurements.

[Score evidence](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-outbound/src/group/score.rs#L82-L179)
is group/target/family/node contextual. It is not a global latency score.
Nested selection, final fallback, demotion, hysteresis and actual cancelled
or failed candidates must be recorded at selection/dial boundaries. A later
`/groups` snapshot cannot explain the historical winner exactly.

### Reload and identity

[Kernel publication](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/ebpf/real/routing.rs#L314-L376)
has its own generation; `active_routing_generation()` currently returns a
slot in [the backend](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/ebpf/real/mod.rs#L523-L524).
[Reload](https://github.com/daeuniverse/honk/blob/780c3f158bbe6e69c02327d5e7ce46d1b594cf4e/crates/honk-core/src/control/reload/transaction.rs#L484-L625)
can reuse the unchanged kernel policy while publishing userspace state.
DNS/registry/diagnostic generations and UDP allocator token bits are different
namespaces. None is a universal flow/config revision by itself.

Keep tuple/token/endpoint-generation safety contracts intact. Add observation
identity before the first potentially failing decision, with per-step producer
generation and immutable dictionaries. Retain terminal evidence before guards
or endpoint retirement remove live entries. Unknown/lost/expired evidence
must remain visible as such, rather than becoming a fabricated clean close.

Serialize sanitized decision-time `member_name` beside selection-path and
candidate `member_id`, and `leaf_node_name` beside candidate and outbound
`leaf_node_id`. These name fields are required but null when unavailable.
IDs remain authoritative. Retained traces must not acquire new names by
joining the current registry after a reload renames or removes a node/group.

## Implementation order, without reducing the target

1. Introduce compact observation ownership at existing TCP guards, UDP leases,
   kernel decision and DNS boundaries; no parallel routing engine.
2. Capture rule inputs/results, domain verification, enforcement, DNS lineage,
   actual member/leaf/transport attempts and lifecycle milestones where produced.
3. Publish a bounded read-only flow store and SSE replay with explicit loss,
   retention, authorization and generation dictionaries.
4. Pass the recorded-flow acceptance scenarios before advertising
   `full_transparency`. A useful partial adapter may advertise `base` meanwhile,
   but is not completion of the full per-flow objective.
