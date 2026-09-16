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
| target | absent | Case-sensitive literal module prefix. |
| Last-Event-ID | absent | Header containing the last processed opaque cursor. |

An invalid or unadvertised level returns `400 invalid_request`. Capabilities
advertise `levels` and `max_buffered_records`; clients must not infer them
from the engine version.

## Response

The example shows the SSE body as a JSON string; `\n` represents a wire
line break.

{% api_example streamLogs 200 records %}

`stream.ready` is the first frame on every connection, including a resume.
Its data uses the [events](events.html) payload: `instance_id`, `observed_at`.
Each `event: log` frame has an `id` and JSON data containing `ts`, `level`,
`target` (module), `message`, and `fields` (object or null). Heartbeat comments
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

The replay buffer holds at most `max_buffered_records`. Close slow clients
when their bounded queue fills; never block engine writers. A reconnect may
fail if the buffer has already evicted its cursor. Follow the shared SSE
[authentication and CORS rules](events.html): no bearer secrets in URLs.
The server reauthorizes each reconnect and closes streams after revocation.
