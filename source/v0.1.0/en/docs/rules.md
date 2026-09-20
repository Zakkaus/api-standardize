---
title: Rules
---

# GET /api/v1/rules

> Proposed read-only rule dictionary for the running routing generation.
> Requires `observe` and `resources.rules.available`. This is not raw
> configuration, a rule editor, or a routing simulation.

## Request

{% api_request listRules %}

## Response

{% api_example listRules 200 running %}

`generation_id` identifies the coherent running generation. `rules` contains
its complete evaluation order, including exactly one final `kind: fallback`
entry. Each entry has `rule_id`, zero-based `index`, safe display `expression`,
`outbound`, boolean `must`, nullable `source`, and `kind` (`rule` or `fallback`).
`source` carries the redacted file label, the source ID from `GET /config`, the one-based line
and the byte column of the rule's first token; return null when the location is unknown or unsafe to
disclose. Do not expose absolute local paths or raw config.
The top-level `fallback` repeats that entry's `outbound` and `source`.

`rule_id` is identical to the IDs used by
[POST /routing/trace](routing-trace.html) and `FlowSummary.rule_id` within the
same generation. Join by `(generation_id, rule_id)`, never by expression or
index alone. The dictionary does not prove which rule decided a flow, and an
outbound is not a resolved leaf or evidence of a successful dial.

## Generation changes and limits

`generation_id` is the invalidation cursor; this endpoint has no pagination
or `410 snapshot_expired` response. Refetch on `generation.changed` from the
[events feed](events.html). Do not join retained old-generation flows to the
new dictionary. Without events, poll and replace the dictionary when its
generation changes.

`resources.rules.max_rules` bounds the complete list, including fallback.
Never truncate silently. Return `503 temporarily_unavailable` if the list
cannot fit, or `409 snapshot_unavailable` if the adapter cannot pin one
coherent generation. A generation change alone is not an expired snapshot.

## Editing

Rules are part of the configuration. Each rule carries `source` with its file label, source ID, line and column. An editor opens the source by ID at that line and writes the whole file back through the configuration editing endpoints: `PUT /api/v1/config/sources/{source_id}` with `If-Match`, validation before any write, then a reload operation. There is no rule-level write endpoint.
