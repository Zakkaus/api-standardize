---
title: dae/honk Native API Documentation
---

# dae/honk Native API Documentation

Welcome to the dae/honk API documentation. This site defines a proposed native
HTTP JSON control plane for Linux transparent-proxy engines and documents the
existing Clash-compatible surface separately.

## Overview

dae and honk are Linux eBPF transparent-proxy engines. The native API allows a
client to:

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

## Quick Start

### Configuration

The draft native listener uses `/api/v1`, with unversioned `/api` discovery. honk currently
configures its Clash-compatible listener with `experimental.clash_api`; the
referenced dae/kdae branch currently has no general REST listener and exposes
reload/suspend through CLI and signals. See [API Configuration](docs/api-config.html)
for the proposed shared listener contract.

```dae
api {
    listen: '127.0.0.1:9527'
    secret: 'replace-with-a-random-secret'
    allow_origins: ['http://127.0.0.1:3000']
}
```

The native listener is loopback-only by default. See [API Configuration](docs/api-config.html)
for the shared listener, authentication, and CORS contract.

### Base URL

```
http://localhost:9527/api/v1  # native API draft, wire major 1
http://localhost:9090         # honk Clash compatibility API
```

### Authentication

If a bearer secret is configured, include it in requests:

```
Authorization: Bearer <your-token>
```

## API Version

Native API status: **draft**. `/api/v1` identifies the wire major, not a claim
that honk 1.0 or this API is released. The `v0.1.0` site directory is the
document revision. Breaking wire changes require a new major path; additive
features are negotiated through capabilities, never inferred from engine
versions. Unversioned resource routes are not aliases.

The [OpenAPI contract](/openapi.yaml) is the generated public bundle. Its
authoring sources live under `api/`, grouped by resource, with native named
examples owned by their operations. Edit those sources and run `npm run build`;
do not edit the bundle or copy example payloads into this prose.

`npm run check:contract` bundles and lints the specification, validates its
structured examples, headers and flow invariants, and runs independent
regressions. Markdown references stable example names through project-owned
Hexo tags; it is rendered from the contract, not parsed back into one.
The human explanations of permissions, visibility and lifecycle remain
hand-authored. Generated clients and an embedded UI remain outside this spec.

Builds clear Hexo's rendered-page cache so changed contract examples cannot
leave stale documentation behind. Restart `npm run server` after changing
`api/` sources; ordinary prose edits still use Hexo's normal development loop.

See [honk implementation evidence](docs/honk-mapping.html) for the current
instrumentation gaps and the disposition of PR #1's comments. Native JSON
and the existing Clash API stay side by side. A separate panel or LuCI
client can use the native API; whether its assets ship embedded or as an
external UI does not change this contract.

## Endpoints

{% api_endpoints %}

The separate honk Clash-compatible surface remains at `/version`, `/configs`,
`/proxies`, and its other compatibility routes; it is not part of this native table.
