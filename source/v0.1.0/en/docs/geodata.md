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
download source with userinfo, query and fragment removed, or null when the
backend has no source for that asset. Reading never touches the network.

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

A distinct update while one is queued or running returns
`409 state_conflict`. Replaying the same accepted `Idempotency-Key` returns
its original operation. A full bounded queue returns
`503 temporarily_unavailable` with a positive `Retry-After`.
