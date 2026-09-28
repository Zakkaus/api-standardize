---
title: Discovery
---

# GET /api

> Draft endpoint. This resource identifies the native API surface and points to
> the bootstrap resources. Engine version information remains exclusively at
> `GET /api/v1/version`.

## Request

{% api_request getDiscovery %}

## Response

Discovery is public in every auth mode. A caller the listener admits gets the
full view: a valid bearer or session, or no credential on an explicitly
secretless loopback listener. Any other request without a credential gets the
public view. A request that carries a credential is authenticated first, and an
invalid one gets `401 authentication_required`, never the public view.

### Full view (200 OK)

{% api_example getDiscovery 200 draft %}

### Public view (200 OK)

{% api_example getDiscovery 200 public %}

The public view has only `name`, `api_major`, `links.auth_setup`,
`links.auth_login`, `auth.mode`, and `auth.setup_required`, with the meanings
below. Other fields are withheld, not null.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| name | string | `daeuniverse/native`, the same for every engine; engine identity is `engine.name` in [version](version.html). |
| status | string | API design status; currently `draft`. |
| api_major | integer | Selected wire major, currently 1; independent of document/engine version. |
| base_path | string | Versioned native resource prefix. |
| links | object | Stable bootstrap links. This is not a capability declaration. |
| links.version | string | Stable `/api/v1/version` link for engine identity. |
| links.capabilities | string | Stable `/api/v1/capabilities` link; the authoritative feature declaration. |
| links.config | string | Stable `/api/v1/config` link; capabilities declare availability, content visibility, and source limits. |
| links.config_validate | string | Stable `/api/v1/config/validate` link for POST; capabilities declare availability, modes, and limits. |
| links.runtime | string | Stable `/api/v1/runtime` link for runtime status. |
| links.runtime_outbounds | string | Stable `/api/v1/runtime/outbounds` link; availability is declared by capabilities. |
| links.traffic_history | string | Stable `/api/v1/runtime/traffic/history` link; availability and limits are declared by capabilities. |
| links.memory_history | string | Stable `/api/v1/runtime/memory/history` link; availability and limits are declared by capabilities. |
| links.logs | string | Stable `/api/v1/logs` link; capabilities declare levels and buffer capacity. |
| links.providers | string | Stable `/api/v1/providers` link; capabilities declare refresh, management support and page size. |
| links.geodata | string | Stable `/api/v1/geodata` link; capabilities declare update support and asset kinds. |
| links.rules | string | Stable `/api/v1/rules` link; capabilities declare the rule limit. |
| links.operations | string | URI template `/api/v1/operations/{operation_id}` for reading one operation; the string is fixed on the wire, and the placeholder name is not significant under simple string expansion. |
| links.auth_setup | string or null | `/api/v1/auth/setup` in password mode; null otherwise. |
| links.auth_login | string or null | `/api/v1/auth/login` in password mode; null otherwise. |
| links.auth_logout | string or null | `/api/v1/auth/logout` in password mode; null otherwise. |
| links.x-&lt;engine&gt; | object, optional | The engine's [extension](capabilities.html#Engine-extensions) links, each under `/api/v1/x-<engine>/`, in the admitted view only; the public view's links stay closed. No other link member is allowed. |
| auth | object | Authentication mode. |
| auth.mode | string | `password` or `token`. |
| auth.setup_required | boolean | Whether password-mode administrator setup is required. |
| auth.anonymous_loopback | boolean | Whether loopback peers may enter without a credential in token mode. |

Clients use `links.version` for engine identity and `links.capabilities` to
discover which optional resources and actions the running adapter implements.
The discovery response must not copy the engine version or the
Clash-compatible `/version` payload.

In password mode, use setup when `auth.setup_required` is true and login when
it is false. In token mode, use the configured bearer when the response is the
public view or `auth.anonymous_loopback` is false, and no credential when it is
true. When discovery answers `401`, use the configured bearer.

## Example

```bash
curl http://localhost:9527/api
```
