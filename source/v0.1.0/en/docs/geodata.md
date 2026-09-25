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
| assets[].download_route | The route the file was downloaded through: `route` as `download` was set for that download, and `group_id` the group the request went through, including the group the routing rules chose. Null when the backend did not download the file. |
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

Every request, the checksum included, leaves through the route in
`download` (see below). A URL the route cannot reach, because the group has no
usable member or the routing rules send it to `block`, counts as a connection
error, and the backend tries the next URL. It never falls back to direct.

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
| auto_update.enabled | Update on a schedule. On by default. |
| auto_update.interval_hours | Hours between automatic updates, 6 to 168, default 24. |
| source | Read-only: where the stored URL lists came from, `config`, `db` or `default`. |
| download.route | How downloads leave the device: `routing` (default), `group` or `direct`. |
| download.group_id | The group for `route: group`, as in `GET /groups`; null otherwise. |

`GET /runtime/settings` needs only `observe`. The URLs are returned as written,
with only listener-secret values masked, to an authenticated caller with
`control`, who may edit them. Every other caller, including the anonymous
loopback principal, receives them redacted like `source_redacted`.

The stored settings are the only ones in force. At startup, before anything
reads them, the backend writes each geodata download URL the configuration file
names, and the download route it names, into the stored settings, replacing a
patched value. Activations never
change them, so a patch lasts until the next startup. For an asset the file
names no URL for, a list an earlier file wrote is deleted and the built-in URLs
apply, while a patched list is kept. The route follows the same rule, and
does not affect `source`. The file never sets `auto_update`.

`source` tells a client where the stored URL lists came from:

- `config`: every stored list was written from the configuration file. A panel
  can still edit them, and should say that the file sets them again at the next
  startup.
- `db`: a patch stored at least one list.
- `default`: no list is stored and the backend's built-in sources apply.

An asset without a stored list uses its built-in URLs under any `source`.

{% api_example getRuntimeSettings 200 config_sources %}

A patch merges into the stored settings and may set URLs under any `source`. Setting `geosite` or `geoip`
stores both URL lists, so `source` becomes `db`; a `urls` list replaces the
whole list. `auto_update` is stored on its own and never changes `source`.
`"geodata": null` deletes everything stored: the URLs return to the built-in
sources, and `auto_update` to its defaults. A configuration file that names URLs
writes them again at the next startup.
Plain `http` URLs are accepted, but a file fetched without a published checksum
is unverified, so prefer `https`. Changing `geodata` requires `control` and an
authenticated caller; the anonymous loopback principal gets
`403 permission_denied`. The backend keeps the settings across restarts and
activations, apart from the writes from the configuration file described above. A patch never downloads anything; queue an update
to fetch from the new URLs.

{% api_request patchRuntimeSettings geodata_sources %}

{% api_example patchRuntimeSettings 200 geodata_stored %}

{% api_request patchRuntimeSettings geodata_auto_update %}

{% api_request patchRuntimeSettings geodata_reset %}

## Choose the download route

`download` decides how every geodata request leaves the device:

- `routing`, the default: the routing rules decide, as for user traffic, so a
  rule can send the download to a node, a group, direct or `block`. Every
  download the backend makes itself follows the routing rules unless configured
  otherwise.
- `group`: always through the group in `group_id`, whatever the rules say.
- `direct`: straight to the host, outside the routing rules.

{% api_request patchRuntimeSettings geodata_download %}

`group_id` is a current group id from `GET /groups`, required for `group` and
not allowed otherwise. An id that is not a current group returns
`422 unsupported_value` and changes nothing. `download` is stored on its own,
like `auto_update`. If the stored group later disappears from the
configuration, `group_id` reads null and downloads fail until the route is
changed.

The route must be able to carry the request when the update runs. Just after
startup the routing rules may not be loaded yet, or a group's health checks may
not have finished; a request the route cannot carry fails that URL like a
connection error, the backend tries the next URL, and when all fail it reports
`last_error`. It never switches to direct on its own, so a download meant for a
proxy is not sent in the clear.

Automatic updates are on by default, every 24 hours, so the loaded files follow
the upstream lists without a manual update. Set `auto_update.enabled` to false
to stop them. Each wait adds a random delay of up to 60 minutes, so many
devices do not download at once. A failed attempt is retried with exponential
backoff starting at one hour and never longer than the interval; a success
restores the normal interval.
