---
title: Geodata
---

# Geodata

> Proposed endpoints for the geosite and geoip files the routing rules match
> against. Reading requires `observe`; updating requires `control` and the
> operation resource.

## Read the loaded assets

`GET /api/v1/geodata` requires `resources.geodata.available`; otherwise it
returns `404 capability_not_supported`.

{% api_request getGeoData %}

{% api_example getGeoData 200 loaded %}

One entry per kind in `resources.geodata.assets` describes the file the
running datapath was built from: `sha256` of the file, `size_bytes` as a
UInt64 decimal string, `modified_at` (nullable) and `source_redacted`, the
display-only download source with userinfo, query, fragment, and secret-bearing
path segments removed or redacted. With several configured URLs it shows the
first. It is null when no source is configured or safe display is impossible.
Reading never touches the network.

When `resources.geodata.configurable_sources` is true, the response also
carries the update status, and each asset reports where its file came from:

| Field | Meaning |
|-------|---------|
| assets[].fetched_url_redacted | Display-only URL the loaded file was downloaded from, redacted like `source_redacted`. Null when the backend did not download it, for example a file installed by a package. |
| assets[].verified | The file matched the sha256 published beside its URL. False when no checksum was published or the backend did not download the file. |
| last_checked_at | When the last update attempt, manual or automatic, finished, whatever its outcome. |
| last_updated_at | When an update last replaced a loaded file. |
| next_check_at | When the next automatic update is due, including its random delay and any backoff. Null while automatic updates are off. |
| last_error | A [SafeError](errors.html) with an adapter-defined code when the last attempt failed on every URL; null otherwise. |
| required_codes | Per asset kind, the lowercase category names the active configuration references, sorted and without attribute suffixes. |

The timestamps are null before the first attempt. A backend without the
capability omits all of these fields.

{% api_example getGeoData 200 packaged %}

`required_codes` lets a client check a smaller file before choosing it: a
replacement that lacks any listed category fails the update, so a panel can warn
about the missing categories up front instead.

## Update the assets

`POST /api/v1/geodata/update` takes no body and requires
`resources.geodata.can_update`.

{% api_request updateGeoData %}

{% api_example updateGeoData 202 queued http %}

Poll `Location` using the [operation contract](operations.html), obeying
`Retry-After`. The kind is `geodata_update`. The backend downloads every asset
from its source into a temporary file, verifies it parses, replaces the loaded
file and reloads the datapath once, emitting `generation.changed`. An asset
that fails to download or parse leaves the loaded file in place and fails the
operation with a SafeError. Success returns the new GeoData in `result`.
Identical bytes leave the loaded file and the generation unchanged.

With several URLs for an asset, the backend tries them in order and moves to
the next only when one fails:

- a connection error or the per-URL deadline;
- any status other than `200`. Redirects are not followed, so a link that
  redirects, such as a GitHub `/releases/download/` URL, never works; use a
  raw or CDN URL that serves the file directly;
- a sha256 mismatch. When a checksum is published at the URL with
  `.sha256sum` appended, the backend fetches and compares it; without one the
  file is accepted unverified and `verified` is false.

The update also fails, keeping the loaded file, when the new file lacks a
category the active configuration uses. The backend writes updated files to its
own data directory and never overwrites files a package manager installed.

Every URL is fetched under the administrator SSRF policy. Only default ports
are allowed unless an administrator configures an explicit port allowlist.
After resolution, loopback, link-local, multicast, unspecified, private, and
cloud-metadata destinations are rejected unless present in an
administrator-owned destination allowlist. The validated address is pinned for
the connection. The adapter enforces bounded response size and timeout.

A distinct update while one is queued or running returns
`409 state_conflict`. Replaying the same accepted `Idempotency-Key` returns
its original operation. A full bounded queue returns
`503 temporarily_unavailable` with a positive `Retry-After`. An automatic
update runs as the same operation kind, so a manual request while one runs also
returns `409 state_conflict`.

## Configure the sources

When `resources.geodata.configurable_sources` is true, the download URLs and
automatic updates are the `geodata` section of
[runtime settings](runtime-status.html#GET-api-v1-runtime-settings), read with
`GET` and changed with `PATCH /api/v1/runtime/settings`.

{% api_example getRuntimeSettings 200 current %}

| Field | Meaning |
|-------|---------|
| geosite.urls, geoip.urls | Up to 4 URLs per asset, in fallback order, each at most 4096 bytes with no userinfo or fragment. |
| auto_update.enabled | Update on a schedule. Off by default. |
| auto_update.interval_hours | Hours between automatic updates, 6 to 168, default 24. |
| source | Read-only: where the URLs come from, `config`, `db` or `default`. |

`GET /runtime/settings` needs only `observe`. The URLs are returned as written,
with only listener-secret values masked, to an authenticated caller with
`control`, who may edit them. Every other caller, including the anonymous
loopback principal, receives them redacted like `source_redacted`.

`source` tells a client who owns the URLs:

- `config`: the configuration file names a download URL. The file owns the
  URLs, a panel shows them read-only, and a patch that sets `geosite` or
  `geoip` returns `409 state_conflict`. A URL list is empty when the file names
  no URL for that asset. `auto_update` stays settable.
- `db`: a patch stored the URLs.
- `default`: no URLs are stored and the backend's built-in sources apply.

{% api_example getRuntimeSettings 200 config_sources %}

{% api_example patchRuntimeSettings 409 geodata_from_config %}

A patch merges into the effective settings. Setting `geosite` or `geoip`
stores both URL lists, so `source` becomes `db`; a `urls` list replaces the
whole list. `auto_update` is stored on its own and never changes `source`.
`"geodata": null` deletes everything stored: the URLs return to the
configuration file or the built-in sources, and `auto_update` to its defaults.
Plain `http` URLs are accepted, but a file fetched without a published checksum
is unverified, so prefer `https`. Changing `geodata` requires `control` and an
authenticated caller; the anonymous loopback principal gets
`403 permission_denied`. The backend keeps the settings across restarts and
configuration activations. A patch never downloads anything; queue an update
to fetch from the new URLs.

{% api_request patchRuntimeSettings geodata_sources %}

{% api_example patchRuntimeSettings 200 geodata_stored %}

{% api_request patchRuntimeSettings geodata_auto_update %}

{% api_request patchRuntimeSettings geodata_reset %}

Automatic updates are off by default so a device never downloads on a schedule
without its owner's consent. When on, each wait adds a random delay of up to 60
minutes, so many devices do not download at once. A failed attempt is retried
with exponential backoff starting at one hour and never longer than the
interval; a success restores the normal interval.
