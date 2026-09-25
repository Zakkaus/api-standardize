---
title: Providers
---

# Providers

Reads require `observe`; refresh, create, and delete require `control`. Provider
create and delete edit the managed main source. Provider reads and refreshes do
not change the configured source.

## List providers

`GET /api/v1/providers` requires `resources.providers.available`.

{% api_request listProviders %}

`limit` defaults to the smaller of 100 and `max_page_size`, with a wire ceiling
of 1000. A larger-than-advertised limit returns `400 invalid_request`.
`next_cursor` is null at the end of the list. Cursors bind to the running
instance and retained snapshot. An unknown, expired, or invalidated cursor
returns `400 invalid_request`; discard it and restart the page walk.
If the server cannot retain the snapshot within its budget, it returns
`503 snapshot_unavailable` with `Retry-After`.

{% api_example listProviders 200 providers %}

## Read one provider

{% api_request getProvider %}

{% api_example getProvider 200 subscription %}

`id` is the identity used by `Node.provider_id`, not a URL or display name.
`kind` is `subscription`, `file`, or `inline`. `node_count` is a safe integer.
Neither GET starts a subscription fetch.

`url_redacted` carries the configured URL as written, with only listener-secret
values masked; the wire name is kept for compatibility. Return null for
file/inline sources. `name` is the configured tag.

`updated_at` is the last successful load or refresh; `expires_at` is the
provider-reported expiry. Both are nullable. `traffic` is null without usage
metadata; otherwise `upload_bytes`, `download_bytes`, and `total_bytes` are
nullable UInt64 decimal strings. `total_bytes` is the reported allowance,
not upload plus download; unknown or unlimited allowance is null.

`status` is `ok` for usable current data, `stale` for retained older data or a
newly created provider that has not been fetched, and `error` when a failure
leaves no usable data. `last_error` is a [SafeError](errors.html) or null.

## Refresh a provider

`POST /api/v1/providers/{id}/refresh` takes no body and requires
`resources.providers.can_refresh`. An unsupported action or provider kind
returns `404 capability_not_supported`.

{% api_request refreshProvider %}

{% api_example refreshProvider 202 queued http %}

Poll `Location` using the [operation contract](operations.html), obeying
`Retry-After`. The kind is `provider_refresh`; success returns the refreshed
Provider in `result`. Failure uses SafeError and retains the last successfully
loaded nodes. Refetch providers and nodes after completion.

A distinct refresh for a provider already queued or running returns
`409 state_conflict`. Replaying the same accepted `Idempotency-Key` returns
its original operation before checking that conflict. A full bounded queue
returns `503 temporarily_unavailable` with a positive `Retry-After`.

## Add a subscription

`POST /api/v1/providers` requires `resources.providers.can_manage`; otherwise
it returns `404 capability_not_supported`. Only `kind: subscription` can be
created: file and inline providers are authored in the configuration sources.

{% api_request createProvider subscription %}

{% api_example createProvider 201 created http %}

The backend writes the provider into the managed main source, advances the
configuration revision, and emits `generation.changed`. A subsequent write to
that changed source using its old `content_sha256` receives `412 stale_revision`;
a generation change alone does not invalidate an unchanged source's hash.
The provider is created
unfetched (`node_count` 0, `updated_at` null, `status` stale); call refresh
to load it. The URL is stored and never returned. A name already in use
returns `409 state_conflict`; a URL that is not http(s) returns
`422 unsupported_value`.

{% api_request createProvider options %}

`update_interval`, `user_agent` and `cache` are optional. Each is accepted only
when `resources.providers.create_options` names it, and that object gives the
value an omitted field takes. Sending one it does not name returns
`422 unsupported_value`.

- `update_interval`: seconds between automatic refreshes, up to one year;
  `0` refreshes only on request.
- `user_agent`: the User-Agent header for fetching the URL, 1 to 256 printable
  ASCII characters.
- `cache`: whether the last fetched body is kept so the provider loads without
  the network at startup. `false` keeps none and removes one already kept. A
  backend with caching turned off globally does not list it.

## Delete a provider

`DELETE /api/v1/providers/{id}` requires `resources.providers.can_manage`. An
inline provider returns `404 capability_not_supported`: it is the `node`
section itself and is edited through [nodes](node-latency.html) or the
configuration sources.

{% api_request deleteProvider %}

{% api_example deleteProvider 200 deleted %}

Deletion removes the provider's line from the managed main source and its
nodes from the running groups, advances the configuration revision and emits
`generation.changed`. It is idempotent: an unknown id returns `deleted` 0. A
group whose only member source was the provider is left empty.
