---
title: Version
---

# GET /api/v1/version

> Draft endpoint. This is the canonical native API version resource. Use
> `GET /api` only for general API discovery, `GET /api/v1/capabilities` for
> feature negotiation, and `GET /api/v1/runtime` for live process state.

Returns the native API identity and the version of the running engine. The
response is independent of the engine implementation language.

## Request

{% api_request getVersion %}

## Response

### Success (200 OK)

{% api_example getVersion 200 build %}

### Fields

| Field | Type | Description |
|-------|------|-------------|
| api.name | string | Stable name of the native API surface. |
| api.status | string | Current API design status. The draft value is `draft`. |
| api.major | integer | Wire major selected by `/api/v1`, independent of engine release. |
| engine.name | string | Running engine name, such as `dae` or `honk`. |
| engine.version | string | Engine release or build version. It may be `unknown` when the build does not provide one. |
| build | object or null | Optional generic build metadata. |
| build.revision | string or null | Source revision when embedded at build time. |
| build.target | string or null | Build target triple or platform identifier. |
| build.built_at | string or null | Build timestamp (RFC3339), when reproducibility policy allows it. |

Build metadata is optional and must not be required by clients. If an engine
exposes it, the generic fields are `build.revision`, `build.target`, and
`build.built_at`; `build.built_at` uses RFC3339. Implementation-specific fields
such as `go_version` are not part of the native contract.

The native response must not reuse the Clash-compatible `/version` response.
For example, honk keeps its existing `version` string with the `honk ` prefix
and its dashboard compatibility flags on that separate endpoint.

## Example

```bash
curl http://localhost:9527/api/v1/version
```
