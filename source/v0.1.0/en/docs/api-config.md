---
title: API Configuration
---

# API Configuration

> This page is retained as a configuration draft for the proposed native
> contract. Current honk uses
> `experimental.clash_api.external_controller` and `secret`; the referenced
> dae/kdae branch has no general REST listener. A top-level `api { }` block is
> therefore a proposed adapter configuration, not an existing dae feature.

The shared adapter should use a single listen address, an opaque bearer secret,
and explicit CORS origins. Interface-name wildcards and regexes are not part of
the native contract because they make binding and authorization ambiguous.

## Proposed native listener fields

```dae
api {
    listen: '127.0.0.1:9527'
    secret: 'replace-with-a-random-secret'
    allow_origins: ['http://127.0.0.1:3000']
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| listen | address | yes | One explicit host and port. Loopback is the default deployment. |
| secret | string | no | Opaque bearer secret; required for non-loopback exposure. |
| allow_origins | string array | no | Explicit browser origins. Empty means browser CORS is disabled. |

The exact configuration section is engine-owned: honk currently uses
`experimental.clash_api.external_controller` and `secret`, while dae/kdae
needs an adapter implementation before this block becomes active.

## Listener and authentication rules

- Omitting `listen` binds only to loopback.
- A non-loopback listener requires `secret`; otherwise startup fails closed.
- `secret` is opaque. Implementations may enforce a minimum entropy policy but
  must not require one specific textual encoding.
- Authentication uses `Authorization: Bearer <secret>`. Secrets must not appear
  in URLs, responses, or logs.
- Browser access is disabled unless the exact request origin is listed in
  `allow_origins`; wildcard origins are not valid with bearer credentials.
- Browsers send CORS preflights without credentials. The server validates the
  origin, requested method, and requested headers, then answers the preflight
  without bearer authentication; the actual request is authenticated as usual.
- Non-loopback bearer transport MUST use TLS at the listener or a trusted
  local reverse proxy; a secret sent over untrusted cleartext is not secure.
- Reject unapproved browser Origins on all native requests, including
  mutation POSTs with simple content types; require the documented JSON
  content types. Check Host against configured listener/proxy hostnames to
  prevent DNS rebinding of an unauthenticated loopback listener.
- On a secretless loopback listener, reject browser requests marked
  `Sec-Fetch-Site: cross-site`, even without Origin. Cross-site GET navigation
  must not trigger a control action such as a live DNS query.

The native and Clash-compatible surfaces may share one socket, but their route,
authentication, and CORS middleware remain independent. They may also use
separate listeners without changing native `/api/v1/*` paths.

## Permissions

The native API defines two permissions:

| Permission | Access |
|------------|--------|
| `observe` | Runtime, memory, datapath, nodes, groups, connections, recorded flows, permitted events, DNS cache, and operation results owned by the caller. |
| `control` | Probes, routing simulations, live DNS queries, group mutations, DNS cache mutations, reload, suspend, and resume. Includes `observe`. |

The proposed single `secret` grants `control`. Implementations may support
additional observe-only credentials, but must preserve these permission names.
Missing or invalid credentials return `401`; an authenticated credential
without the required permission returns `403` without revealing whether the
target exists. Discovery, version, and capabilities require no permission once
the caller has reached the listener.

Under the current loopback-compatible default, omitting `secret` grants local
callers both permissions. Capability flags describe engine support, not caller
authorization.

`detail=summary` only reduces response size. It does not redact data for a
less-privileged user. An admitted caller is an administrator: configuration,
rule values, provider URLs and paths are returned in the clear, and only
listener-secret values are masked, consistently in snapshots, recorded steps,
errors and replayed events; a trace is marked partial when a mask hid required
evidence.
