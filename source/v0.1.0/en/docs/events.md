---
title: Events
---

# GET /api/v1/events

> Proposed bounded SSE feed. Polling remains supported. This feed notifies
> clients of state changes; it is neither a packet stream nor durable storage.

Requires `observe`; operation notifications additionally obey operation
ownership/control visibility. Accept `text/event-stream`. Successful streams
use `Content-Type: text/event-stream`, `Cache-Control: no-store`, and disabled
proxy buffering where supported. Errors before streaming use the shared JSON
envelope. Heartbeat comments are sent at most 15 seconds apart while idle.

| Parameter | Default | Meaning |
|-----------|---------|---------|
| kinds | all permitted advertised kinds | Comma-separated event kinds below. |
| flow_id | absent | Limit flow notifications to one flow. |

A kind outside the event kinds below, a repeated kind, or a malformed
`flow_id` returns `400 invalid_request`; a listed kind that the capabilities do
not advertise returns `422 unsupported_value`. With `max_clients` streams
already open, a new stream returns `503 temporarily_unavailable` with
`Retry-After`. A `Last-Event-ID` that can no longer be replayed returns
`409 event_cursor_expired`. See [errors](errors.html#Choosing-the-status).

{% api_request streamEvents %}

{% api_event FlowUpdated %}

Event `id` is opaque and unique within an instance. The example's textual
shape is not a parsing contract. Resume with `Last-Event-ID`; bearer secrets
never go in URLs. Native browser `EventSource` cannot set Authorization:
use streaming `fetch` with the header and an SSE parser, or a same-origin
server-side credential boundary. Do not add query tokens or weaken auth to
accommodate `EventSource`.

Cross-origin access follows the
[listener rules](api-config.html#Listener-and-authentication-rules).

## Event kinds

Each named event has one JSON `data` object. Unknown kinds/fields are ignored.

| Kind | Payload | Invalidates |
|------|---------|-------------|
| `stream.ready` | `instance_id`, `observed_at`. Signals that replay is attached and new events are buffered. No resource ID. Sent on every connection, even if not in `kinds`. | Every resource on a fresh stream: fetch the baselines as described under [Replay and recovery](#Replay-and-recovery). |
| `runtime.updated` | `instance_id`, `observed_at`, `href` (`/api/v1/runtime`). Coalesced invalidation; fetch the current snapshot. Also sent when a `degradations` entry is added, changed or cleared. | Runtime status, outbound counters, traffic and memory history, runtime memory, runtime settings, capabilities (a recorder mode change moves `resources.flows.recording` without a new generation), group selection and health, node health, and the connection list. |
| `flow.updated` | `instance_id`, `observed_at`, `resource_id` (flow ID), `revision`, `href`. Includes first observation, decisions, attempts, status changes, and terminal state. Fetch the retained record; coalescing must preserve the latest revision. | That flow and the flow list. |
| `flow.gap` | `instance_id`, `observed_at`, nullable `resource_id`, `reason` (`buffer_overflow`, `sampled`, `evicted`, `recording_changed`), nullable `dropped_records` (the same decimal uint64 string counter used by flow coverage). No invented close event. | The flow list and its coverage, and the named flow when `resource_id` is not null. |
| `operation.updated` | `instance_id`, `observed_at`, `resource_id`, `status`, `href`. Only operations visible to this caller. The normal GET operation envelope is authoritative. | That operation. What the operation changed is announced by the `runtime.updated` or `generation.changed` its effect produces. |
| `generation.changed` | `instance_id`, `observed_at`, `previous_generation_id`, `generation_id`. Sent only after successful publication/promotion, never just on reload acceptance. | Every generation-scoped resource: capabilities, configuration, nodes, groups, providers, geodata, rules, DNS rules, the datapath, runtime status and runtime settings. |

A server sends `runtime.updated` after any change to a resource in its row. It
may coalesce changes and send one event at the next sampling tick. Every
activation, including one that keeps the current generation, is followed by
`runtime.updated` once its runtime-settings reset is visible; an activation
that publishes a new generation also sends `generation.changed`. Clients
subscribed to the relevant event kinds can use the Invalidates column to
refresh the listed resources. Resources not listed there keep their own
refresh rules.

All advertised events use the same instance and generation identities as
GET resources. The stream publishes only IDs, state, and safe reason codes;
sensitive rule inputs, DNS answers, process names and configuration do not
appear in notification payloads. Flow detail requires a separate authorized
GET. Operation IDs must not leak through events to other observe principals.

## Replay and recovery

The connection, cursor, replay, queue and authorization rules below also apply
to log streams; [logs](logs.html#Replay-and-recovery) lists only where its
stream differs. Baseline snapshots and flow revisions apply only to `/events`.

- Every connection starts with `stream.ready`, which carries a replay cursor.
  On a fresh connection the client then fetches its baseline snapshots,
  buffers notifications that arrive during those GETs, applies them after the
  snapshots, and ignores older or equal flow revisions. This closes the
  snapshot/subscribe race without requiring a database log.
- On a resumed connection, `stream.ready` comes before replay. Its cursor must
  not skip unread retained events: keep the supplied `Last-Event-ID` until
  replay advances it. The server then delivers matching retained events
  strictly after that cursor and switches to live delivery without an
  unobserved gap.
- Duplicate delivery is permitted; deduplicate by event ID, and flow snapshots
  by `(instance_id, id, revision)`. Filtered-out IDs may leave gaps; clients
  must not infer loss by subtracting IDs.
- A cursor is bound to the filters it was issued under. An unknown, expired,
  or previous-instance cursor, or one sent with changed `kinds` or `flow_id`,
  returns `409 event_cursor_expired` **before** a `200` stream begins. The
  client discards the cursor, opens a new stream, waits for ready, and
  refetches snapshots. Never silently resume at the present or pretend lost
  history was recovered.
- If a slow client exceeds its bounded queue, close the stream. Reconnection
  replays from its last acknowledged event; if that is no longer retained,
  return the cursor-expired error. No unbounded queues and no blocking
  datapath writers. Loss before the replay buffer is separately reported by
  `flow.gap` and flow coverage, not hidden as a successful replay.
- Recheck credentials on reconnect and terminate a live stream when its
  authorization is revoked. Bearer secrets never go in URLs.

Capabilities advertise `kinds`, `retention_seconds`, `max_buffered_events`,
`max_clients`, and `heartbeat_seconds`. Retention is an upper bound subject
to buffer pressure; no at-least-once durable guarantee. A stream proves event
delivery, not that the underlying engine captured all routing decisions.
