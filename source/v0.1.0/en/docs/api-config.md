---
title: API Configuration
---

# API Configuration

This page describes native listener security, authentication and permissions.
How an engine configures its listener is engine-specific; honk's keys are in
the [honk notes](honk-notes.html#Listener-configuration-in-honk).

A server uses one listen address and explicit CORS origins. Token mode may use
a deployment secret; password mode uses session tokens. Interface-name
wildcards and regexes are not part of the native contract because they make
binding and authorization ambiguous.

## Listener and authentication rules

- A listener without a configured address binds only to loopback.
- A non-loopback listener requires deployment-secret authentication or
  password authentication; otherwise startup fails closed.
- The deployment secret is opaque. Implementations may enforce a minimum entropy policy but
  must not require one specific textual encoding.
- Authentication uses `Authorization: Bearer <secret>`. Secrets must not appear
  in URLs, responses, or logs.
- Cross-origin browser access requires the exact origin in the listener's
  allowed-origin list. An empty list disables cross-origin access; same-origin
  requests are unaffected. Bearer authentication still follows the listener configuration.
- For an allowed origin, CORS permits the `Authorization`, `Last-Event-ID`,
  `Content-Type`, `If-Match`, `Idempotency-Key`, and `Accept` request headers,
  and exposes `Location`, `Retry-After`, and `ETag`.
- Browsers send CORS preflights without credentials. The server validates the
  origin, requested method, and requested headers, then answers the preflight
  without bearer authentication; the actual request keeps its normal
  authentication and permission checks.
- Non-loopback bearer transport MUST use TLS at the listener or a trusted
  local reverse proxy; a secret sent over untrusted cleartext is not secure.
- Reject unapproved browser Origins on all native requests, including
  mutation POSTs with simple content types; require the documented JSON
  content types. Check Host against configured listener/proxy hostnames to
  prevent DNS rebinding of an unauthenticated loopback listener.
- On a secretless loopback listener, reject browser requests marked
  `Sec-Fetch-Site: cross-site`, even without Origin. Cross-site GET navigation
  must not trigger a control action such as a live DNS query.

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
earlier, for example to stay within its session limit. A request with an ended
session gets `401 authentication_required`, and an event stream opened with it
closes. Password mode has no deployment secret and does not admit anonymous
loopback callers. [Authentication](auth.html) describes setup and login.

## Permissions

The native API defines two permissions:

| Permission | Access |
|------------|--------|
| `observe` | Runtime, memory, datapath, nodes, groups, connections, recorded flows, permitted events, DNS cache, and operation results owned by the caller. |
| `control` | Probes, routing simulations, live DNS queries, group mutations, DNS cache mutations, reload, suspend, and resume. Includes `observe`. |

The deployment secret and a password session grant `control`. Implementations
may support additional observe-only credentials, but must preserve these
permission names. Missing or invalid required credentials return `401` with
`WWW-Authenticate: Bearer`. An
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

This table applies to every endpoint, event and recorded step. Admitted callers
have the same visibility regardless of permission, authentication mode, or
`detail` tier. `detail=summary` omits fields to reduce response size, not to
restrict access.

| Data | Returned to every admitted caller |
|------|-----------------------------------|
| Listener secrets: the deployment secret of each API listener, the administrator password, and session tokens | Secret values are masked in source text, paths, diagnostics, URLs, errors, events, and recorded steps. A session token is returned only in the setup or login response that issues it. |
| Configuration source text, paths, and rule values | As written, apart from listener secrets. |
| Provider URLs and geodata source URLs (`geodata.*.urls` in runtime settings) | As written, apart from listener secrets. |
| Display URLs: `source_redacted` and `fetched_url_redacted` | The display form in [Geodata](geodata.html#Read-the-loaded-assets). |
| Error and diagnostic messages | Safe text built by the engine: parser and log output is sanitised, not forwarded. No raw engine output, stack traces, source excerpts or raw configuration, and no listener secrets. |
| Log records | Sanitised as [Logs](logs.html) describes. |
| Writes to geodata sources | `control` and a credential; an anonymous loopback caller gets `403 permission_denied`. |
| Configuration writes | As `resources.config.writable` advertises; an engine may keep writes off on a secretless listener. |

A listener secret is identified by its role, not by a key name. An engine masks the fields that
carry these secrets, and the deployment secret values it holds, before it
stores or emits text. It need not keep a recoverable password or past session
tokens to find other copies of them.

Proxy and subscription credentials are not listener secrets. Node definitions,
share links and provider URLs that carry them are returned to every admitted
caller as written.

A trace is marked partial when a mask hid required evidence. A response that
masked a value says so where its schema has a flag, such as `secrets_redacted`.

## Outbound requests

Group health checks (`check_url`), [node checks](probes.html), and
[geodata downloads](geodata.html) follow this outbound-request policy against
server-side request forgery (SSRF).

- HTTP URLs must be absolute `http` or `https` URLs without userinfo. TCP and
  DNS check destinations are host and port pairs and follow the address and
  port rules below.
- A check-execution request cannot name a destination the configuration does
  not already hold. An authorised write can: a configuration source, a group
  `check_url` PATCH, or a geodata source PATCH changes the configured
  destinations. API callers cannot change the destination or port allowlists;
  the deployment owns them.
- Port rules depend on the destination kind. An `http` or `https` URL may use
  its scheme's default port (80 or 443) or a port in the deployment's port
  allowlist. A TCP connect check dials the node's configured server port, and
  any nonzero port is allowed. A DNS check target may use port 53 or a port in
  the allowlist. Port 0 is never allowed.
- The rules apply after the final route is selected and before each dial,
  including each retry. When the engine resolves the name itself, whether the
  route is direct or through a node, it rejects loopback, link-local,
  multicast, unspecified, private and cloud-metadata addresses unless the
  destination allowlist names them, and dials the validated address it pinned.
  When a node resolves the name, the engine checks only a destination written
  as a literal address. A literal address is always checked. The HTTP `Host`
  header and TLS SNI keep the name from the URL.
- A group health check dialled through the group's own members validates a
  patched `check_url` like one written through a
  [configuration source](configuration.html). The address and port rules do
  not apply to it, including through a direct member.
- A geodata URL equal, as the exact string, to the URL the configuration file
  names for that asset is exempt from the address and port rules, for both the
  file download and its checksum request. The same URL set by a geodata source
  PATCH is exempt too; any other URL follows every rule.
- The engine bounds response size and time. Where a feature follows
  redirects, it bounds their number and repeats these checks for each one;
  geodata downloads follow none.
