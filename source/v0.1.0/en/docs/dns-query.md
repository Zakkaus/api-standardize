---
title: DNS Query
---

# POST /api/v1/dns/query

Requires `control` and `resources.dns_query.available`. This POST performs a
live diagnostic query through the configured DNS module. It returns a separate
DNS result for each requested record type and uses `Cache-Control: no-store`.

The method is POST because the request is not safe in the RFC 9110 sense: it
sends DNS traffic and, with `cache_mode: normal`, writes the runtime cache. As
with the [routing trace](routing-trace.html), the queried name travels in the
JSON body rather than in the URL, so it is not copied into access logs.

## Request

{% api_example queryDns request dual_stack http %}

## Request body

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| domain | string | - | Domain name to query (required). |
| type | array of strings | `["A"]` | Unique IANA record type mnemonics such as `A`, `AAAA`, `HTTPS`, `SVCB`, `SRV`, `CNAME`, `MX`, `TXT`, `NS`, `SOA`, or `PTR`; numeric types are allowed when unknown qtypes are advertised. |
| upstream | string | - | Force a specific upstream defined in `dns.upstream` (e.g. `alidns`). If omitted, the upstream is chosen by `dns.routing`. |
| cache_mode | string | normal | `normal` reads and writes the runtime cache; `bypass` reads from upstream and neither reads nor writes the cache. |

The `detail` query parameter stays in the URL: `summary` (default) omits answer
RDATA; `full` includes `answers`. A body that is not JSON returns `415`.

## Response

### Success (200 OK)

{% api_example queryDns 200 dual_stack %}

### Fields

| Field | Type | Description |
|-------|------|-------------|
| domain | string | Query domain name |
| cache_mode | string | Cache behavior used for this query |
| query_time | string | Timestamp of the query (RFC3339) |
| results | array | One result for each requested record type. |
| results[].type | string | Requested record type. |
| results[].cached | bool | Whether this type was served from cache. |
| results[].cache_entry_id | string or null | Cache entry ID, if one exists. |
| results[].upstream | string or null | Upstream used; `null` for a cache hit. |
| results[].route.source | string | `forced`, `dns.routing`, or `default`. |
| results[].route.rule | string or null | Safe identifier or summary of the matched route. |
| results[].status | string | DNS response code such as `NOERROR`, `NXDOMAIN`, or `SERVFAIL`. |
| results[].elapsed_ms | int | Per-type elapsed time in milliseconds. |
| results[].question | object | DNS question. |
| results[].answers | array, optional | DNS answer records with `detail=full`. |

This is a new diagnostic query, not the DNS history of an existing flow.
`route` describes the request-side choice only; response requeries,
resolver-server routing, actual carriers and exact flow correlations belong
to recorded DNS/route steps. Cache hits may not retain the origin upstream;
null is not permission to reconstruct it from the current configuration.

`question` contains the queried name and type. With `detail=full`, `answers`
contains DNS records with `name`, `type`, `class`, `ttl`, and `data`; TTL is in
seconds. Summary responses omit answer RDATA. See the OpenAPI `DnsQuestion` and
`DnsAnswer` schemas for exact types.

### Errors and limits

A syntactically valid DNS execution returns `200` even when a per-type DNS
status is `NXDOMAIN` or `SERVFAIL`. Invalid names and types use the
[shared error envelope](errors.html). Canonical names are limited to 255 DNS
wire octets and 63 octets per label. Requested types must be unique; duplicates
return `400 invalid_request`. More types than
`resources.dns_query.limits.max_types_per_request` returns `413`.
Check request-rate limits before dispatch; excess returns `429` with
`Retry-After`. Bound execution by the advertised timeout and response-size limit.
An unavailable DNS subsystem returns `503`.

## Example

```bash
curl -X POST "http://localhost:9527/api/v1/dns/query?detail=full" \
  -H 'Content-Type: application/json' -d '{"domain":"example.com","type":["A"]}'
curl -X POST http://localhost:9527/api/v1/dns/query \
  -H 'Content-Type: application/json' -d '{"domain":"example.com","type":["A","AAAA"]}'
curl -X POST http://localhost:9527/api/v1/dns/query \
  -H 'Content-Type: application/json' -d '{"domain":"example.com","upstream":"googledns"}'
```
