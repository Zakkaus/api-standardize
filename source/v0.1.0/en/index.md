---
title: dae/honk Native API Documentation
---

# dae/honk Native API Documentation

This site defines the native HTTP JSON control plane of dae and honk, the Linux
eBPF transparent-proxy engines. It is a draft: each engine implements it
separately, and neither is required to support every resource.

## Overview

The native API allows a client to:

- Monitor real-time traffic statistics
- Discover engine capabilities and datapath visibility
- Read sanitized runtime, routing, node, group, and DNS state
- Start typed probes without conflating TCP reachability with proxy latency
- Track asynchronous reload/suspend operations
- Explain each recorded flow from rule inputs through dialing/DNS/rerouting,
  actual outbound attempts, and connection outcome
- Simulate hypothetical routing without confusing predictions with history
- Follow bounded, resumable server-sent events

Resource bodies use **JSON**; group patches use JSON Patch and the event
feed uses `text/event-stream` with JSON data. Native responses send
`Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; bearer
credentials are never accepted in a URL query parameter.

Unsigned 64-bit quantities are canonical decimal JSON strings from `"0"` through
`"18446744073709551615"`: no leading zeros (except `"0"`), sign, decimal point,
or exponent. Clients must preserve them as strings or parse them as arbitrary-
precision integers (`BigInt`), never `Number`; bounded counts and limits, flow
revisions, and step `seq` values remain JSON numbers. Configuration and selection
revision identifiers remain opaque strings and must not be parsed.

## Implementing an engine

Read the pages in this order. Steps 1 to 3 make up the `base`
[conformance profile](docs/capabilities.html#Conformance-profiles); every
resource in step 4 is optional and advertised in the capabilities.

1. Discovery and authentication: [Discovery](docs/discovery.html),
   [Authentication](docs/auth.html), and the listener, authentication-mode and
   permission rules in [API Configuration](docs/api-config.html).
2. The base resources: [Version](docs/version.html),
   [Capabilities](docs/capabilities.html) and [Runtime](docs/runtime-status.html).
3. The shared rules every endpoint follows: [Errors](docs/errors.html), the
   [visibility table](docs/api-config.html#Visibility), and
   [Operations](docs/operations.html), which are required once any advertised
   action is asynchronous.
4. Optional resources, in any order: [Runtime Memory](docs/runtime-memory.html),
   [Datapath](docs/datapath.html), [Nodes](docs/node-latency.html),
   [Probes](docs/check-nodes.html), [Groups](docs/groups.html),
   [Connections](docs/connections.html), [Recorded Flows](docs/flows.html),
   [Routing Simulation](docs/routing-trace.html), [Events](docs/events.html),
   [Logs](docs/logs.html), [DNS Query](docs/dns-query.html),
   [DNS Cache](docs/dns-cache.html), [DNS Rules](docs/dns-rules.html),
   [Providers](docs/providers.html),
   [Geodata](docs/geodata.html), [Rules](docs/rules.html),
   [Configuration](docs/configuration.html), [Reload](docs/reload.html) and
   [Suspend](docs/suspend.html).

The [OpenAPI contract](/openapi.yaml) is the generated bundle of every request,
response and event. The pages explain the rules a schema cannot state; engine
routes, capabilities and fields outside the shared contract use the
[`x-<engine>` namespace](docs/capabilities.html#Engine-extensions). The
[honk notes](docs/honk-notes.html) record choices honk makes where the contract
leaves them to the engine; they are not part of the contract. To change the
contract or build this site, see the repository README.

## Terms

| Term | Meaning |
|------|---------|
| engine | The proxy product that implements the API, such as dae or honk. `engine.name` in [Version](docs/version.html) names it. |
| server | The engine's API listener in its HTTP role: it answers requests. |
| instance | One engine process. `instance_id` changes on restart, and IDs, cursors, operations and idempotency keys are valid only within one instance. |
| runtime generation | One published runtime configuration, `generation.active_id` in [Runtime](docs/runtime-status.html). |
| datapath generation | One kernel policy publication, `ebpf.routing.generation_id` in [Datapath](docs/datapath.html). A reload can publish a new runtime generation and keep the datapath generation. |
| configuration revision | The opaque `revision` of the accepted configuration, used by runtime and group responses. It is not the source-write precondition. |
| source hash | `content_sha256` of one source's accepted bytes. A source replacement sends it in `If-Match`. |
| accepted snapshot | The configuration sources the active generation was built from, as `GET /config` returns them. It can differ from the configuration store. |
| configuration store | The authoritative copy of every configuration source: files for a file-backed engine, records for a database-backed one. |
| admitted caller | A caller the listener accepts under its [authentication mode](docs/api-config.html#Authentication-modes). Every admitted caller has the same visibility. |
| principal | The identity an admitted caller acts as. Operation ownership and per-principal rate limits are scoped to it; the engine decides how credentials map to principals. |
| flow ID | The opaque `id` of a [recorded flow](docs/flows.html#Identity-and-lifetime), never reused within an instance. |
| connection ID | The opaque ID of a live connection in [Connections](docs/connections.html). A flow's `connection_id` is null when the flow never had a userspace tracker entry. |

## API Version

Native API status: **draft**. `/api/v1` identifies the wire major, not a claim
that honk 1.0 or this API is released; discovery at `/api` is unversioned. The
`v0.1.0` site directory is the document revision. Breaking wire changes require
a new major path; additive features are negotiated through capabilities, never
inferred from engine versions. Unversioned resource routes are not aliases.

## Endpoints

{% api_endpoints %}
