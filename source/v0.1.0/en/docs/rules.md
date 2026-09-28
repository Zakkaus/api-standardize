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
entry. Each entry has `rule_id`, zero-based `index`, `expression` (see
[Rule expressions](#Rule-expressions)),
`outbound`, boolean `must`, nullable `source`, and `kind` (`rule` or `fallback`).
When present, `source` contains the source `file` as written, apart from
listener secrets (see [Visibility](api-config.html#Visibility)), the
configuration `source_id`, a one-based `line`, and a one-based UTF-8 byte
`column`. `column` is null when unknown; `source` is null when the location is
unavailable. Coordinates refer to the original source before listener secrets
are masked.
The top-level `fallback` repeats that entry's `outbound` and `source`.

`rule_id` is identical to the IDs used by
[POST /routing/trace](routing-trace.html) and `FlowSummary.rule_id` within the
same generation. Join by `(generation_id, rule_id)`, never by expression or
index alone. A flow summary carries its rule's generation in
`rule_generation_id`; join it to this dictionary only when that equals
`generation_id`. When it is null or names another generation, do not join the
summary to the current rule dictionary.
The dictionary does not prove which rule decided a flow, and an outbound is not
a resolved leaf or evidence of a successful dial.

## Generation changes and limits

Use `generation_id` to detect a changed dictionary. This endpoint has no
pagination or `410 snapshot_expired` response. Refetch on `generation.changed` from the
[events feed](events.html). Do not join retained old-generation flows to the
new dictionary. Without events, poll and replace the dictionary when its
generation changes.

`resources.rules.max_rules` bounds the complete list, including fallback, and
is never below the running generation's size: an engine with a fixed bound
either refuses a configuration whose list would exceed it or advertises the
larger size. The list is therefore always returned complete, never truncated.
Return `503 snapshot_unavailable` if the engine cannot pin one coherent
generation. A generation change alone is not an expired snapshot.

## Rule expressions

`expression` in this list and in [DNS rules](dns-rules.html) is display text,
produced the same way for both. When the engine retains the source text,
`expression` is that text; otherwise it is the engine's rendering of the
parsed rule. Listener secrets in it are masked (see
[Visibility](api-config.html#Visibility)); nothing else is removed. It is never
an editable or executable source representation; edit the source instead.

## Editing

Rules are edited through their configuration sources, not a rule-level write
endpoint. When `source` is non-null, use `source.source_id` to open the source at
`source.line`; `source.file` is only a display label. Follow the
[configuration editor flow](configuration.html#Editor-flow), including source
writability, the content-hash check, quoted `If-Match`, and reload polling.
Do not offer source editing when the location or complete editable text is unavailable.
