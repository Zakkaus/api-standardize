---
title: Providers
---

# Providers

> Proposed provider metadata and refresh endpoints. Reads require `observe`;
> refresh requires `control`. No endpoint edits provider configuration.

## List providers

`GET /api/v1/providers` requires `resources.providers.available`.

{% api_request listProviders %}

`limit` defaults to the smaller of 100 and `max_page_size`, with a wire ceiling
of 1000. A larger-than-advertised limit returns `400 invalid_request`.
`next_cursor` is null at the end of the list. Cursors bind to the running
instance and retained snapshot. An unknown, expired, or invalidated cursor
returns `400 invalid_request`; discard it and restart the page walk.

{% api_example listProviders 200 providers %}

## Read one provider

{% api_request getProvider %}

{% api_example getProvider 200 subscription %}

`id` is the identity used by `Node.provider_id`, not a URL or display name.
`kind` is `subscription`, `file`, or `inline`. `node_count` is a safe integer.
Neither GET starts a subscription fetch.

`url_redacted` is display-only: remove userinfo, query, fragment, and
secret-bearing path segments. Return null for file/inline sources or when
safe display is impossible. Names and errors must also be safe; never expose
credentials, raw configuration, or unredacted local paths.

`updated_at` is the last successful load or refresh; `expires_at` is the
provider-reported expiry. Both are nullable. `traffic` is null without usage
metadata; otherwise `upload_bytes`, `download_bytes`, and `total_bytes` are
nullable UInt64 decimal strings. `total_bytes` is the reported allowance,
not upload plus download; unknown or unlimited allowance is null.

`status` is `ok` for usable current data, `stale` for retained older usable
data, or `error` when a failure leaves no usable data. `last_error` is a
[SafeError](errors.html) or null, never raw engine output.

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
