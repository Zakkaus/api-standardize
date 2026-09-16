---
title: Configuration
---

# Configuration

The native API exposes the effective configuration and dry-run validation of
engine-native candidate text. Writing configuration is a later contract change.
There is no `PUT`, `PATCH`, or apply endpoint for this resource.

## GET /api/v1/config

Requires `observe` and `capabilities.resources.config.available`. Returns the
accepted configuration, not a fresh read of files that may have changed on disk.
Sources, diagnostics, `generation_id`, and `revision` belong to one coherent
snapshot. The source set is complete, not silently truncated to `max_sources`.

### Request

{% api_request getConfig %}

### Success (200 OK)

{% api_example getConfig 200 redacted %}

The all-zero SHA-256 in this example is a placeholder, not a digest of a real
configuration.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| generation_id | string | Running generation for this accepted configuration. |
| revision | string | Opaque configuration revision used by `Runtime.generation.config_revision` and `GroupSummary.config_revision`; never parse it as a number. |
| sources | array | Complete accepted source set, bounded by `resources.config.max_sources`. |
| sources[].id | string | Unique opaque ID within the snapshot; never a private path or credential-bearing URL. |
| sources[].path | string | Display path, or `<redacted>` when hidden by visibility policy. |
| sources[].kind | string | `main`, `include`, `subscription`, or `generated`. |
| sources[].content_sha256 | string | Lowercase 64-hex SHA-256 of accepted bytes before redaction. |
| sources[].bytes | integer | Accepted byte count before redaction; nonnegative safe integer. |
| sources[].loaded_at | string | RFC 3339 time when the engine accepted these bytes, not file modification time. |
| sources[].content | string, optional | Engine-native text, only when `resources.config.content` is true; secret redaction still applies. |
| sources[].line_count | integer | Lines before redaction; empty text has zero lines, and a final newline adds no empty line. |
| diagnostics | array | Retained diagnostics for the accepted configuration, using the shared shape below. |
| secrets_redacted | boolean | True when the adapter withholds content or redacts paths, text, or diagnostic messages. |

### Visibility

`capabilities.resources.config.content` is a visibility flag, false by default.
When false, every source omits `content`; it must not return an empty string as a
substitute. When true, content remains optional and must not expose secrets to
ordinary `observe` callers. Path redaction follows the existing visibility rules
in [Capabilities](capabilities.html#Configuration-visibility) and
[API Configuration](api-config.html#Permissions): apply privacy filters
consistently, not only to one endpoint or detail tier. Diagnostics must not echo
source excerpts, credentials, private paths, or raw engine errors. Hashes, byte
counts, line counts, and positions describe the accepted source before redaction;
they need not match displayed text. Redacted text is not an editing representation.
Never save it over the source.

## POST /api/v1/config/validate

Requires `control` and `capabilities.resources.config_validate.available` because
the body may contain secrets. Validation never writes files, refreshes caches,
applies configuration, publishes a generation, or starts an operation.

### Request

{% api_example validateConfig request syntax_error http %}

| Field | Type | Description |
|-------|------|-------------|
| sources | array | Nonempty ordered candidate source set; the first source is the main source. |
| sources[].id | string, optional | Request-local diagnostic ID; omitted IDs become `source-N`, with a one-based array index. All effective IDs must be unique and must not contain secrets. |
| sources[].path | string, optional | Engine-native source name and include-resolution base within authorized local roots; not permission to read arbitrary files. |
| sources[].content | string | Candidate engine-native text; empty text is a candidate, not a malformed request. |
| mode | string | Required `syntax` or `full`, selected from `resources.config_validate.modes`. |

`syntax` parses only submitted text. `full` also checks semantics and resolves
includes/subscriptions from submitted sources or adapter-authorized local files
and cached data. Submitted content takes precedence at the same resolved path.
Neither mode accesses the network. Missing or inaccessible dependencies produce
error diagnostics, not a successful partial validation.

`max_bytes` bounds the sum of UTF-8 source bytes, not JavaScript string length.
`max_sources` bounds the source count. Both include locally resolved dependencies
in `full` mode. The shared `limits.max_json_body_bytes` separately bounds the
encoded HTTP body. Exceeding any size or source-count limit returns
`413 request_too_large`, without truncation or partial success.

### Success (200 OK)

{% api_example validateConfig 200 invalid %}

| Field | Type | Description |
|-------|------|-------------|
| valid | boolean | True exactly when validation completed without error diagnostics; warnings and info do not invalidate the candidate. |
| diagnostics | array | Shared diagnostic shape below, with IDs referring to submitted sources. Attribute dependency failures to the referring submitted source and include/subscription location. |
| generation_id | string | Running generation captured when validation starts, for context only. |
| validated_at | string | RFC 3339 time when validation completed. |

A completed validation returns `200` even when the candidate is invalid.
`valid: true` does not guarantee that a later apply will succeed. A concurrent
reload may change the running generation; this result neither pins it for a
later apply nor changes the effective configuration or revision.

Malformed JSON, invalid request shape, or duplicate effective source IDs returns
`400 invalid_request`. An unadvertised mode returns `422 unsupported_value`.
Unavailable resources return `404 capability_not_supported`. Authentication,
permission, media-type, and rate failures use the [shared errors](errors.html).

## Diagnostic fields

Both endpoints use `ConfigDiagnostic`. Diagnostic codes are adapter-defined,
not members of the HTTP `ErrorCode` catalogue.

| Field | Type | Description |
|-------|------|-------------|
| level | string | `error`, `warning`, or `info`. |
| source_id | string | Source ID in the effective snapshot or validation request. |
| line | integer or null | One-based source line; null when unknown. |
| column | integer or null | One-based UTF-8 byte column, not a character or UTF-16 offset; null when unknown. |
| span | object or null | `start_line`, `start_column`, `end_line`, `end_column`; one-based, start inclusive and end exclusive. End must not precede start; adapters may return zero-width spans. |
| code | string | Nonempty adapter-defined diagnostic code. |
| message | string | Safe operator-facing description, never raw parser output. |

Coordinates refer to the original source before redaction. When known, `line`
and `column` equal the span start. Unknown locations stay null; adapters must
not invent positions from setting names.

## honk mapping

These are new native resources, not aliases of honk's Clash `/configs`.
That GET exposes compatibility settings and metadata diagnostics; its PUT is a
no-op. Honk already retains accepted diagnostics, but native readback needs
accepted-source bytes and metadata captured with the configuration. Candidate
validation needs a separate bounded, side-effect-free path through the parser.
See the [source evidence](honk-mapping.html). Reload remains the existing
[`POST /api/v1/operations/reload`](reload.html) action on engine-owned configuration.
