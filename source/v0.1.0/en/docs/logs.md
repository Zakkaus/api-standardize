---
title: Logs
---

# GET /api/v1/logs

> Proposed bounded SSE feed of sanitized engine logs. Requires `observe` and
> `resources.logs.available`; this is not a recorded-flow trace or durable log.

## Request

{% api_request streamLogs %}

| Parameter | Default | Meaning |
|-----------|---------|---------|
| level | all advertised levels | Minimum severity: `trace`, `debug`, `info`, `warn`, `error`, in ascending order. |
| target | absent | Case-sensitive literal prefix of a record's `target`. |
| Last-Event-ID | absent | Header containing the last processed opaque cursor. |

A level outside the five above returns `400 invalid_request`; one of them that
`levels` does not advertise returns `422 unsupported_value` (see [errors](errors.html#Choosing-the-status)).
`filters` lists the query filters the engine applies; `level` is always
listed, and `target` on an engine that does not list it returns
`422 unsupported_value`. Capabilities advertise `levels`, `filters`,
`retention_seconds`, `max_buffered_records` and the optional
`min_buffered_records`; clients must not infer them
from the engine version.

## Response

The example shows the SSE body as a JSON string; `\n` represents a wire
line break.

{% api_example streamLogs 200 records %}

`stream.ready` is the first frame on every connection, including a resume.
Its data uses the [events](events.html) payload: `instance_id`, `observed_at`.
Each `event: log` frame has an `id` and JSON data containing `ts`, `level`,
`target` (the emitting component, or null when the engine does not report
one), `message`, and `fields` (object or null). A `target` filter never
matches a record whose `target` is null. Heartbeat comments
arrive at most 15 seconds apart while idle and do not advance the cursor.

Sanitize messages and structured fields before buffering. No secrets,
credentials, raw configuration, stack traces, or unredacted local paths may
appear, including inside nested fields. Do not forward raw engine output.

## Replay and recovery

Resume strictly after `Last-Event-ID`, then switch to live delivery without
an unobserved gap. The initial ready cursor must not skip pending replay;
keep the supplied cursor until replay advances it. Deduplicate by frame ID,
not by timestamp or message. IDs are opaque; gaps may reflect filtering.

Cursors are bound to the stream, instance, and filters. Unknown, expired,
previous-instance, and changed-filter cursors return `409 event_cursor_expired`
before any `200` stream opens. Drop the cursor and reconnect for a new
baseline; do not present lost records as recovered history. Log cursors and
notification cursors are not interchangeable.

The replay buffer holds at most `max_buffered_records` records, none older
than `retention_seconds`. Close slow clients when their bounded queue fills;
never block engine writers. A reconnect fails if the buffer has already
evicted its cursor, including a quiet filtered stream whose last record aged
out. Follow the shared SSE
[authentication and CORS rules](events.html): no bearer secrets in URLs.
The server reauthorizes each reconnect and closes streams after revocation.

## Settings

The level the engine emits at and the replay ring size are runtime settings;
see [`/runtime/settings`](runtime-status.html#GET-api-v1-runtime-settings).
A lower stream `level` cannot recover records the engine did not emit.

## Log retention

The replay ring retains at most the configured `log.buffered_records`, bounded
by `resources.logs.max_buffered_records`, and drops records older than
`resources.logs.retention_seconds`. It clears on process restart and does not
provide durable storage.

[Recorded flows](flows.html), [traffic history](runtime-status.html#GET-api-v1-runtime-traffic-history),
[memory history](runtime-memory.html#GET-api-v1-runtime-memory-history), and
[operations](operations.html) have separate retention rules. History request
limits do not guarantee ring retention.
