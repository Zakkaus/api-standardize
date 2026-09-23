---
title: DNS Cache
---

# DNS Cache

> Draft endpoints: `GET /api/v1/dns/cache`, `DELETE /api/v1/dns/cache/{entry_id}`,
> filtered `DELETE /api/v1/dns/cache`, and `POST /api/v1/dns/cache/flush`.
> Cache introspection and mutations are independently declared under
> `resources.dns_cache` by `GET /api/v1/capabilities`.

These endpoints operate on the engine's runtime DNS cache only. They do not
flush the kernel conntrack table, the host stub resolver, an upstream DNS
server, or any configured DNS routing rule. They also do not change
`fixed_domain_ttl`, optimistic-cache settings, or the cache size limit.

An implementation that does not expose a capability must return `404` with
`capability_not_supported`; it must not return an empty successful result.

## List entries

### `GET /api/v1/dns/cache`

The response is a paginated snapshot. The cache can change while the client
walks the pages, so `cursor` is opaque and must not be manufactured by a
client.
The server binds the cursor to the running adapter instance, filters, and
retained snapshot. Restart, changed filters, or snapshot expiry/eviction invalidates
it. An unknown or invalidated cursor returns `400 invalid_request`; discard
it and restart without a cursor, never silently continue a different snapshot.

{% api_request listDnsCache %}

## Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| name | string | - | Exact DNS name after canonicalization; matches one question name |
| domain | string | - | Listing-only partial-match convenience filter; never accepted by a delete request |
| type | string | - | Record type filter; may be repeated, for example `type=A&type=AAAA` |
| include_expired | bool | false | Include expired entries that have not yet been lazily evicted |
| limit | int | 100 | Max entries to return; servers cap this value at 1000 |
| cursor | string | - | Opaque cursor returned as `next_cursor` |
| detail | string | summary | `summary` omits answer RDATA; `full` includes `answers`. |

## Response

### Success (200 OK)

{% api_example listDnsCache 200 entries %}

### Fields

| Field | Type | Description |
|-------|------|-------------|
| observed_at | string | Snapshot timestamp (RFC3339). |
| coverage | object | Cache classes represented by this endpoint. |
| entries | array | DNS cache entries |
| total | int | Number of entries matching the filters at snapshot time |
| next_cursor | string | Opaque cursor for the next page, or `null` when complete |
| usage | object, optional | Occupancy of the whole runtime cache; absent on servers that predate it |

`coverage.positive` and `coverage.negative` must match the advertised
`entry_kinds`. `coverage.persistent` declares whether entries outside the
runtime in-memory cache are included. Implementations must not silently omit a
cache class they claim to expose.

`usage` describes the whole runtime cache at snapshot time and ignores the
filters. Every page of one snapshot repeats it. Both fields are UInt64
decimal strings:

| Field | Description |
|-------|-------------|
| entries | Entries currently retained, including expired entries not yet evicted |
| entry_capacity | Effective entry limit after the engine applies its bounds, at most 100,000 |

The entry count is the cache's only limit; the size of an entry is not bounded.
The engine evicts when `entries` reaches `entry_capacity`, so a client showing
how full the cache is should use that ratio. `entries` may exceed
`total`, which counts only entries that match the filters and the listing's
expiry rule. When `usage` is absent, the client has no capacity information and
must not infer one from `total`.

### Entry Object

| Field | Type | Description |
|-------|------|-------------|
| entry_id | string | Opaque runtime entry ID; not stable across restart or full flush |
| domain | string | Canonical DNS name, lower-case A-label with a trailing dot |
| type | string | Question record type, such as `A`, `AAAA`, or `HTTPS` |
| class | string | DNS question class, normally `IN` |
| status | string | `NOERROR`, `NXDOMAIN`, `NODATA`, `SERVFAIL`, or another DNS result |
| answers | array, optional | Complete cached RRset with `detail=full`; an entry is not one individual answer value |
| expires_at | string | Time at which the normal cache lifetime ends (RFC3339) |
| stale_until | string or null | Required end of optimistic stale-answer eligibility (RFC3339); null when stale serving is disabled or the boundary is unavailable. |

Negative results such as `NXDOMAIN` and `NODATA` are cache entries too. A
delete operation removes the complete question/type entry, including every
answer and negative state; deleting one RDATA value from an RRset is not
supported because it would create a response that was never validated by an
upstream.

## Delete one entry

### `DELETE /api/v1/dns/cache/{entry_id}`

Deletes exactly one cache entry identified by the opaque `entry_id` returned
by the list endpoint. The ID must be URL-encoded as a path segment.

{% api_request deleteDnsCacheEntry %}

Deletion is idempotent and returns `200` whether the entry existed:

{% api_example deleteDnsCacheEntry 200 deleted %}

A retry after the entry is gone returns `deleted: 0`.

## Delete matching entries

### `DELETE /api/v1/dns/cache`

Deletes all entries matching an exact name and optional record-type filters.
`name` is required for this endpoint; a partial `domain` filter is never
accepted for deletion. Omitting `type` deletes every type and both positive
and negative entries for that name.

{% api_request deleteDnsCacheByName %}

The response is successful even when no entries matched, which makes retries
safe:

{% api_example deleteDnsCacheByName 200 deleted %}

## Flush the complete runtime cache

### `POST /api/v1/dns/cache/flush`

Flushes all runtime DNS cache entries. This is deliberately an action endpoint
so an unfiltered `DELETE /api/v1/dns/cache` cannot accidentally erase the entire
cache. The request body is empty or `{}`.

{% api_request flushDnsCache %}

The server returns only after the invalidation barrier has been installed:

{% api_example flushDnsCache 200 flushed %}

Queries already in flight may still return their upstream result to their
caller, but a result started before the barrier must not repopulate an entry
that was flushed or deleted. A later normal DNS query may populate the cache
again.

## Mutation errors

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `invalid_name` | The name is missing, malformed, or not canonicalizable |
| 400 | `filter_required` | A collection delete did not include the required exact `name` |
| 404 | `capability_not_supported` | The running engine does not expose this cache operation |
| 503 | `cache_unavailable` | The DNS cache cannot be inspected or mutated at this time |

## Example

```bash
curl "http://localhost:9527/api/v1/dns/cache?domain=google&limit=20&detail=full"
curl -X DELETE \
  "http://localhost:9527/api/v1/dns/cache?name=example.com.&type=A"
curl -X POST \
  "http://localhost:9527/api/v1/dns/cache/flush"
```

# GET /api/v1/dns/log

Requires `observe` and `resources.dns_log.available`. The engine records
every resolution it performs for clients into a ring of at most
`dns_log.max_records`, newest first; diagnostic `/dns/query` calls are not
recorded. The ring is not durable and clears on restart.

{% api_request listDnsLog %}

| Parameter | Meaning |
|-----------|---------|
| name | Case-insensitive substring of the question name. |
| type | One record type. |
| src | Client source IP literal, IPv4 or IPv6. |
| limit | Page size, at most `dns_log.max_page_size`; above it returns `400 invalid_request`. |
| cursor | Opaque cursor from `next_cursor`; older records follow it. |

{% api_example listDnsLog 200 recent %}

| Field | Meaning |
|-------|---------|
| records[].src | Client socket address, IPv6 in brackets; null when the resolver asked on its own behalf. |
| records[].status | RCODE name (`NOERROR`, `NXDOMAIN`, …) or an engine outcome such as `TIMEOUT`. |
| records[].cached | True when the cache answered; `upstream` is then null and `elapsed_ms` is the lookup time. |
| records[].route | The DNS routing decision, the same shape `/dns/query` reports. |
| records[].answers | Answers as returned; empty on a negative or failed resolution. |
| total | Records in the ring at `observed_at`, before filters. |

A record is evidence of what the resolver did for a client at that moment;
it is not the cache entry, which `/dns/cache` lists and may already have
expired or been replaced.
