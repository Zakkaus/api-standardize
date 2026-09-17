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

### Success (200 OK)

{% api_example getDiscovery 200 draft %}

### Fields

| Field | Type | Description |
|-------|------|-------------|
| name | string | Stable name of the native API surface. |
| status | string | API design status; currently `draft`. |
| api_major | integer | Selected wire major, currently 1; independent of document/engine version. |
| base_path | string | Versioned native resource prefix. |
| links | object | Stable bootstrap links. This is not a capability declaration. |
| links.config | string | Stable `/api/v1/config` link; capabilities declare availability, content visibility, and source limits. |
| links.config_validate | string | Stable `/api/v1/config/validate` link for POST; capabilities declare availability, modes, and limits. |
| links.runtime_outbounds | string | Stable `/api/v1/runtime/outbounds` link; availability is declared by capabilities. |
| links.traffic_history | string | Stable `/api/v1/runtime/traffic/history` link; availability and limits are declared by capabilities. |
| links.memory_history | string | Stable `/api/v1/runtime/memory/history` link; availability and limits are declared by capabilities. |

| links.logs | string | Stable `/api/v1/logs` link; capabilities declare levels and buffer capacity. |
| links.providers | string | Stable `/api/v1/providers` link; capabilities declare refresh support and page size. |
| links.rules | string | Stable `/api/v1/rules` link; capabilities declare the rule limit. |

Clients use `links.version` for engine identity and `links.capabilities` to
discover which optional resources and actions the running adapter implements.
The discovery response must not copy the engine version or the
Clash-compatible `/version` payload.

## Example

```bash
curl http://localhost:9527/api
```
