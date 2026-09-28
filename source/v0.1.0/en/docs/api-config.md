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

## Authentication modes

Discovery reports the mode in `auth.mode`. Every mode admits a caller as an
administrator; the modes differ only in how the caller proves it.

| Mode | Credential | Admitted caller |
|------|------------|-----------------|
| `token` with a secret | `Authorization: Bearer <secret>` | `control`, which includes `observe` |
| `token` without a secret, `auth.anonymous_loopback: true` | None; loopback listener only | `control`, except the geodata source write in [Visibility](#Visibility) |
| `password` | `Authorization: Bearer <token>` from [setup or login](auth.html) | `control`, which includes `observe` |

A password session lasts until `expires_at`, until
[logout](auth.html#POST-api-v1-auth-logout), or until the engine ends it
earlier, for example when a new login exceeds the engine's session limit (honk
keeps 32 sessions and ends the oldest). A request with an ended session gets
`401 authentication_required`, and an event stream opened with it closes. A
setup request that carries a live session gets `409 setup_already_completed`,
because an administrator exists; a login request that carries one opens another
session. A mode does not combine with another: password mode has no deployment
secret and no anonymous loopback access.

## Permissions

The native API defines two permissions:

| Permission | Access |
|------------|--------|
| `observe` | Runtime, memory, datapath, nodes, groups, connections, recorded flows, permitted events, DNS cache, and operation results owned by the caller. |
| `control` | Probes, routing simulations, live DNS queries, group mutations, DNS cache mutations, reload, suspend, and resume. Includes `observe`. |

The deployment secret and a password session grant `control`. Implementations
may support additional observe-only credentials, but must preserve these
permission names. Missing or invalid required credentials return `401`. An
authenticated caller without the required permission normally receives
`403 permission_denied`. Operation reads instead return
`404 resource_not_found` for an operation the caller cannot see.

Discovery, version, and capabilities have no `observe` or `control` permission
requirement. Version and capabilities require bearer authentication when the
listener has a deployment secret or runs in password mode. Anonymous access to
them is permitted only on an explicitly secretless loopback listener.

Discovery is public in every mode, so a client can learn how to sign in. A
request without a credential that the listener would not otherwise admit gets
the public view: `name`, `api_major`, `links.auth_setup`, `links.auth_login`,
`auth.mode`, and `auth.setup_required`. See [Discovery](discovery.html).

The curl examples without `Authorization` assume a secretless loopback listener.
On an authenticated listener, send `Authorization: Bearer <secret>`; never put
the secret in the URL.

Capability flags describe engine support, not caller authorization.

## Visibility

This table is the one visibility rule for every endpoint, event and recorded
step; other pages link here instead of restating it. Every admitted caller is
an administrator and sees the same data, whatever its permission, auth mode or
`detail` tier. `detail=summary` only reduces response size.

| Data | Returned to every admitted caller |
|------|-----------------------------------|
| Listener secrets: `native_api.secret`, `clash_api.secret`, the administrator password, and session tokens | Never. A secret value is replaced by a mask wherever it appears: source text, paths, diagnostics, URLs, errors, events and recorded steps. A session token appears only in the setup or login response that issues it. |
| Configuration: source text, paths, diagnostics and rule values | As written, apart from listener secrets. |
| Provider URLs and geodata source URLs (`geodata.*.urls` in runtime settings) | As written, apart from listener secrets. |
| Display URLs: `source_redacted` and `fetched_url_redacted` | The display-only form in [Geodata](geodata.html#Read-the-loaded-assets), for every caller. |
| Error and diagnostic messages | Safe text: no raw engine output, stack traces, source excerpts or raw configuration, and no listener secrets. |
| Log records | Sanitised as [Logs](logs.html) describes. |
| Writes to geodata sources | `control` and a credential; an anonymous loopback caller gets `403 permission_denied`. |
| Configuration writes | As `resources.config.writable` advertises; an engine may keep writes off on a secretless listener. |

A trace is marked partial when a mask hid required evidence. A response that
masked a value says so where its schema has a flag, such as `secrets_redacted`.
