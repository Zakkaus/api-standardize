---
title: honk Notes
---

# honk notes

This page is not part of the contract. It records how honk, on its current
`feat/native-api` branch, implements rules that the contract leaves to the
engine. Another engine may make different choices within the same rules.

## Password sessions in honk

This section is not part of the contract. honk's password mode keeps at most
32 sessions; a login beyond that ends the oldest. Each session lasts 12 hours.
Another engine chooses its own limit and lifetime and reports the end in
`expires_at`.

## Geodata sources in honk

This section is not part of the contract. It records how honk implements the
[geodata lifecycle](geodata.html#Effective-value-and-lifetime) on the current
`feat/native-api` branch; another engine may reach the same effective values
another way.

- honk keeps the geodata settings in its state database. Each stored URL list
  and the download route carry a mark saying whether the configuration file
  wrote them.
- At startup, before anything reads the settings, honk writes
  `geosite_download_url`, `geoip_download_url` and `geodata_download_detour`
  from the configuration file over the stored values. A list or route an
  earlier file wrote and the file no longer names is deleted, so the built-in
  value applies; a patched one is kept.
- `source` is `config` while every stored list carries the file mark, `db`
  once a stored list does not, and `default` when no list is stored. A planned
  honk change renames `db` to `override`.
- A patch that sets one asset's URLs currently stores both lists as patched,
  freezing the other list at its effective value. A planned honk change stores
  only the patched list, as the contract requires.
- honk enforces 4 URLs per asset, an interval of 6 to 168 hours with a default
  of 24, and the `sha256sum` checksum method. A planned honk change advertises
  them as `max_urls`, `interval_hours` and `checksum`, with
  `lifecycle: {file_values: start, overrides_persist: true}`.
- The checksum URL is the file URL with `.sha256sum` appended to its path. A
  `404` accepts the file unverified; any other failure moves to the next URL.
- The next automatic attempt is due at the end of the last attempt, or, before
  the first, at process start or the latest `auto_update` change, plus the wait
  and a random delay of up to 60 minutes. After a failed attempt the wait is a backoff that starts at one
  hour, doubles on each further failure, and never exceeds the interval.

## Runtime settings in honk

This section is not part of the contract. It records how honk implements
[runtime settings](runtime-status.html#GET-api-v1-runtime-settings) and the
recorders on the current `feat/native-api` branch.

- A PATCH accepts `log.buffered_records` and `dns_log.max_records` from 64 to
  512, `flows.max_flows` from 64 to 1024, and `flows.retention_seconds` from 1
  to 300. The startup values are 512, 512, 1024 and 300.
- `resources.runtime_settings.fields` lists `log.level` and
  `log.buffered_records` only when the log recorder is permitted. GET
  `/runtime/settings` reports every settings section, including values absent
  from that list.
- A client is attached while an admitted GET SSE stream on `/events` or
  `/logs` is open, and for 60 seconds after the last one closed or after a
  successful GET on `/flows`, `/flows/{flow_id}` or `/dns/log`. Settings reads,
  HEAD and rejected requests do not renew attachment. In `auto` mode the log
  and DNS-log recorders capture while a client is attached.
- The automatic flow recorder follows flow demand instead, so that an open
  panel does not record full traces for every connection. An admitted GET
  `/events` stream creates demand when its `kinds` include `flow.updated` or
  `flow.gap`, or when it sets a nonblank `flow_id` and its effective kinds
  include a flow kind. Demand lasts while such a stream is open, and for 60
  seconds after the last one closed or after a successful GET on `/flows` or
  `/flows/{flow_id}`. Event streams without `kinds`, `/logs` streams and
  `/dns/log` reads do not create demand, and attachment does not extend it.
- honk currently reports `resources.flows.recording` as `on` or `off` from
  whether the flow recorder is capturing, advertises the current `max_flows`
  and `retention_seconds` rather than its maxima, and omits `min_flows`,
  `logs.min_buffered_records`, `dns_log.min_records`, `logs.filters` and the
  eBPF attachment `kind`. A planned honk change reports all of them as the
  contract requires, with `on_demand` in `auto` mode.
- `grace_remaining_seconds` counts the attachment grace only, not the
  flow-demand grace. Event capture runs while a client is attached or any
  permitted recorder is pinned on.

## Flow steps in honk

This section is not part of the contract. It records honk-specific detail
behind the [flow record](flows.html) rules.

- honk hands UDP decisions between the kernel and userspace through NFQUEUE.
  Its `datapath` steps currently use the core action `drop` and the
  engine-defined actions `activate_direct` and `activate_proxy`
  (`control/connection/udp.rs`). They record the NFQUEUE activation, not each
  hold, arm, verdict and publication step.
- honk's UDP decision token is not a flow ID, and the persisted UDP token
  allocator is not changed to produce flow IDs.
- `mode_override` reports honk's Clash-mode override (`direct` or `global`).
