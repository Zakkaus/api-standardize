---
title: API Configuration
---

# API Configuration

Honk configures its native API under `experimental.native_api`, separately from
`experimental.clash_api`. This page describes native listener security and
permissions; configuration syntax remains engine-specific.

The shared adapter should use a single listen address, an opaque bearer secret,
and explicit CORS origins. Interface-name wildcards and regexes are not part of
the native contract because they make binding and authorization ambiguous.

## Honk listener configuration

Configure the native listener under `experimental.native_api`. Its settings
include `enabled`, `listen`, `secret`, `allow_origins`, and `ui`. Use an explicit
loopback address for local access. A non-loopback listener requires a secret.

`experimental.clash_api.external_controller` configures the separate
Clash-compatible listener.

## Listener and authentication rules

- Omitting `listen` binds only to loopback.
- A non-loopback listener requires `secret`; otherwise startup fails closed.
- `secret` is opaque. Implementations may enforce a minimum entropy policy but
  must not require one specific textual encoding.
- Authentication uses `Authorization: Bearer <secret>`. Secrets must not appear
  in URLs, responses, or logs.
- Cross-origin browser access requires an exact origin in `allow_origins`.
  An empty list disables cross-origin access, not the same-origin `/ui/`
  interface. Bearer authentication still follows the listener configuration.
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

Honk serves the native and Clash-compatible APIs on separate listeners and ports,
with independent routing, authentication, and CORS. Native resources use `/api/v1/*`.

## Permissions

The native API defines two permissions:

| Permission | Access |
|------------|--------|
| `observe` | Runtime, memory, datapath, nodes, groups, connections, recorded flows, permitted events, DNS cache, and operation results owned by the caller. |
| `control` | Probes, routing simulations, live DNS queries, group mutations, DNS cache mutations, reload, suspend, and resume. Includes `observe`. |

The single `secret` grants `control`. Implementations may support additional
observe-only credentials, but must preserve these permission names.
Missing or invalid required credentials return `401`. An authenticated caller
without the required permission normally receives `403 permission_denied`.
Operation reads instead return `404 resource_not_found` for an operation the
caller cannot see.

Discovery, version, and capabilities have no `observe` or `control` permission
requirement. Version and capabilities require bearer authentication when the
listener has a deployment secret. Anonymous access to them is permitted only on
an explicitly secretless loopback listener.

Discovery is public in every mode, so a client can learn how to sign in. A
request without a credential that the listener would not otherwise admit gets
the public view: `name`, `api_major`, `links.auth_setup`, `links.auth_login`,
`auth.mode`, and `auth.setup_required`. See [Discovery](discovery.html).

The curl examples without `Authorization` assume a secretless loopback listener.
On an authenticated listener, send `Authorization: Bearer <secret>`; never put
the secret in the URL.

Under the current loopback-compatible default, omitting `secret` grants local
callers both permissions. Capability flags describe engine support, not caller
authorization.

`detail=summary` only reduces response size. It does not redact data for a
less-privileged user. An admitted caller is an administrator: configuration,
rule values, provider URLs and paths are returned in the clear, and only
listener-secret values are masked, consistently in snapshots, recorded steps,
errors and replayed events; a trace is marked partial when a mask hid required
evidence.
