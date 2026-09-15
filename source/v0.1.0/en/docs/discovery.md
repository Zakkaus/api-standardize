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
| links.runtime_outbounds | string | Stable `/api/v1/runtime/outbounds` link; availability is declared by capabilities. |
| links.traffic_history | string | Stable `/api/v1/runtime/traffic/history` link; availability and limits are declared by capabilities. |

Clients use `links.version` for engine identity and `links.capabilities` to
discover which optional resources and actions the running adapter implements.
The discovery response must not copy the engine version or the
Clash-compatible `/version` payload.

## Example

```bash
curl http://localhost:9527/api
```
