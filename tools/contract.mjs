import { STATUS_CODES } from "node:http";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const DIALECT = "https://json-schema.org/draft/2020-12/schema";
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const METHOD = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);

/**
 * Resolve an OpenAPI carrier Reference Object. Schema Objects are deliberately
 * left to AJV, so a payload property named `$ref` or `schema` is never visited.
 */
function resolve(spec, value, errors, label) {
  const seen = new Set();
  while (isObject(value) && own(value, "$ref")) {
    const ref = value.$ref;
    if (typeof ref !== "string" || (ref !== "#" && !ref.startsWith("#/"))) {
      errors.push(`${label}: only local $ref values are supported`);
      return undefined;
    }
    if (seen.has(ref)) {
      errors.push(`${label}: local $ref cycle at ${ref}`);
      return undefined;
    }
    seen.add(ref);

    let pointer;
    try {
      pointer = decodeURIComponent(ref.slice(1));
    } catch {
      errors.push(`${label}: malformed local $ref ${ref}`);
      return undefined;
    }
    let current = spec;
    if (pointer !== "") {
      for (const rawToken of pointer.slice(1).split("/")) {
        if (/~(?![01])/u.test(rawToken)) {
          errors.push(`${label}: malformed JSON pointer ${ref}`);
          return undefined;
        }
        const token = rawToken.replaceAll("~1", "/").replaceAll("~0", "~");
        if ((!isObject(current) && !Array.isArray(current)) || !own(current, token)) {
          errors.push(`${label}: unresolved local $ref ${ref}`);
          return undefined;
        }
        current = current[token];
      }
    }
    value = current;
  }
  return value;
}

function headerEntry(headers, name) {
  if (!isObject(headers)) return undefined;
  const expected = name.toLowerCase();
  return Object.entries(headers).find(([candidate]) => candidate.toLowerCase() === expected);
}

function readHeaders(example, label, errors) {
  if (!own(example, "x-headers")) return {};
  if (!isObject(example["x-headers"])) {
    errors.push(`${label}: x-headers must be an object`);
    return {};
  }
  return Object.fromEntries(Object.entries(example["x-headers"]));
}

function operations(spec, errors) {
  const result = [];
  const ids = new Map();
  if (!isObject(spec.paths)) {
    errors.push("source/openapi.yaml: paths must be an object");
    return result;
  }
  for (const [path, rawPathItem] of Object.entries(spec.paths)) {
    const pathItem = resolve(spec, rawPathItem, errors, `path ${path}`);
    if (!isObject(pathItem)) continue;
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      const operation = resolve(spec, rawOperation, errors, `${method.toUpperCase()} ${path}`);
      if (!isObject(operation)) continue;
      const operationId = operation.operationId;
      if (typeof operationId !== "string" || operationId.length === 0) {
        errors.push(`${method.toUpperCase()} ${path}: operationId must be a nonempty string`);
        continue;
      }
      if (ids.has(operationId)) {
        errors.push(`duplicate operationId ${operationId}: ${ids.get(operationId)} and ${method.toUpperCase()} ${path}`);
        continue;
      }
      ids.set(operationId, `${method.toUpperCase()} ${path}`);
      result.push({ operationId, method: method.toUpperCase(), path, pathItem, operation });
    }
  }
  return result;
}

function parameterStyle(definition) {
  return definition.style ?? (definition.in === "query" || definition.in === "cookie" ? "form" : "simple");
}

function parameterKey(definition) {
  const name = definition.in === "header" ? definition.name.toLowerCase() : definition.name;
  return `${definition.in}:${name}`;
}

function normalizeParameters(spec, record, errors) {
  const merged = new Map();
  for (const [scope, values] of [
    ["path", record.pathItem.parameters],
    ["operation", record.operation.parameters],
  ]) {
    if (values === undefined) continue;
    if (!Array.isArray(values)) {
      errors.push(`${record.operationId}: ${scope} parameters must be an array`);
      continue;
    }
    for (const [index, raw] of values.entries()) {
      const label = `${record.operationId}: ${scope} parameter ${index}`;
      const definition = resolve(spec, raw, errors, label);
      if (!isObject(definition) || typeof definition.name !== "string" || typeof definition.in !== "string") {
        errors.push(`${label}: invalid Parameter Object`);
        continue;
      }
      if (!["path", "query", "header"].includes(definition.in)) {
        errors.push(`${record.operationId}: unsupported ${definition.in} parameter ${definition.name}`);
        continue;
      }
      const style = parameterStyle(definition);
      const supported = definition.in === "query" ? style === "form" : style === "simple";
      if (!supported) {
        errors.push(`${record.operationId}: unsupported ${style} serialization for ${definition.in} parameter ${definition.name}`);
      }
      if (definition.schema === undefined) {
        errors.push(`${record.operationId}: parameter ${definition.name} has no schema`);
      }
      merged.set(parameterKey(definition), definition);
    }
  }

  const normalized = [];
  for (const definition of merged.values()) {
    if (!own(definition, "example")) {
      if (definition.required === true) {
        errors.push(`${record.operationId}: required ${definition.in} parameter ${definition.name} has no example`);
      }
      continue;
    }
    normalized.push({ definition, value: definition.example });
  }
  return normalized;
}

function normalizeExample(spec, raw, label, errors, hasBody = true) {
  const example = resolve(spec, raw, errors, label);
  if (!isObject(example)) {
    errors.push(`${label}: invalid Example Object`);
    return undefined;
  }
  if (own(example, "value") !== hasBody) {
    errors.push(`${label}: Example Object ${hasBody ? "must contain" : "must not contain"} value`);
    return undefined;
  }
  return example;
}

function addCase(examples, value, errors) {
  if (examples.has(value.id)) errors.push(`${value.id}: duplicate native example key`);
  else examples.set(value.id, value);
}
function requestHeaders(spec, example, parameters, label, errors) {
  const headers = readHeaders(example, label, errors);
  if (!headerEntry(headers, "Host")) {
    try {
      headers.Host = new URL(spec.servers[0].url).host;
    } catch {
      errors.push(`${label}: request examples require an absolute server URL`);
    }
  }
  for (const { definition, value } of parameters) {
    if (definition.in !== "header" || headerEntry(headers, definition.name)) continue;
    headers[definition.name] = value;
  }
  return headers;
}


function normalizeRequests(spec, record, parameters, examples, errors) {
  const rawBody = record.operation.requestBody;
  const requestBody = rawBody === undefined ? undefined : resolve(spec, rawBody, errors, `${record.operationId}: request body`);
  let named = 0;
  if (requestBody !== undefined && !isObject(requestBody)) {
    errors.push(`${record.operationId}: invalid Request Body Object`);
  } else if (isObject(requestBody)) {
    if (!isObject(requestBody.content)) errors.push(`${record.operationId}: request body content must be an object`);
    for (const [mediaType, rawMedia] of Object.entries(requestBody.content ?? {})) {
      const media = resolve(spec, rawMedia, errors, `${record.operationId}: request media ${mediaType}`);
      if (!isObject(media)) continue;
      if (media.examples !== undefined && !isObject(media.examples)) {
        errors.push(`${record.operationId}: ${mediaType} examples must be an object`);
        continue;
      }
      for (const [name, rawExample] of Object.entries(media.examples ?? {})) {
        named += 1;
        const id = `${record.operationId}:request:${name}`;
        const example = normalizeExample(spec, rawExample, id, errors);
        if (!example) continue;
        if (media.schema === undefined) errors.push(`${id}: request media type has no schema`);
        addCase(examples, {
          id,
          kind: "request",
          operationId: record.operationId,
          method: record.method,
          path: record.path,
          mediaType,
          schema: media.schema,
          body: example.value,
          headers: requestHeaders(spec, example, parameters, id, errors),
          parameters,
        }, errors);
      }
    }
  }

  if (requestBody?.required === true && named === 0) {
    errors.push(`${record.operationId}: required request body has no named native example`);
  }
  if (requestBody?.required !== true) {
    const id = `${record.operationId}:request`;
    addCase(examples, {
      id,
      kind: "request",
      operationId: record.operationId,
      method: record.method,
      path: record.path,
      mediaType: undefined,
      schema: undefined,
      body: undefined,
      headers: requestHeaders(spec, {}, parameters, id, errors),
      parameters,
    }, errors);
  }
}

function responseHeaderDefinitions(spec, response, label, errors) {
  if (response.headers === undefined) return {};
  if (!isObject(response.headers)) {
    errors.push(`${label}: response headers must be an object`);
    return {};
  }
  const definitions = {};
  for (const [name, raw] of Object.entries(response.headers)) {
    const header = resolve(spec, raw, errors, `${label}: header ${name}`);
    if (isObject(header)) definitions[name] = header;
    else errors.push(`${label}: header ${name} is not a Header Object`);
  }
  return definitions;
}

function checkAcceptedResponse(record, status, definitions, errors) {
  if (status !== "202") return;
  for (const name of ["Location", "Retry-After"]) {
    const entry = headerEntry(definitions, name);
    if (!entry || entry[1].required !== true) {
      errors.push(`${record.operationId}: 202 response requires ${name} with required: true`);
    }
  }
}

function normalizeResponses(spec, record, examples, errors) {
  if (!isObject(record.operation.responses)) {
    errors.push(`${record.operationId}: responses must be an object`);
    return;
  }
  for (const [statusKey, rawResponse] of Object.entries(record.operation.responses)) {
    const label = `${record.operationId}:${statusKey}`;
    const response = resolve(spec, rawResponse, errors, `${label}: response`);
    if (!isObject(response)) continue;
    const headerDefinitions = responseHeaderDefinitions(spec, response, label, errors);
    checkAcceptedResponse(record, statusKey, headerDefinitions, errors);
    if (statusKey === "204") {
      if (response.content !== undefined) errors.push(`${label}: 204 must not declare content`);
      if (response["x-examples"] !== undefined && !isObject(response["x-examples"])) {
        errors.push(`${label}: x-examples must be an object`);
        continue;
      }
      // OpenAPI has no standard example carrier for a response without content.
      for (const [name, rawExample] of Object.entries(response["x-examples"] ?? {})) {
        const id = `${label}:${name}`;
        const example = normalizeExample(spec, rawExample, id, errors, false);
        if (!example) continue;
        addCase(examples, {
          id,
          kind: "response",
          operationId: record.operationId,
          status: 204,
          headers: readHeaders(example, id, errors),
          headerDefinitions,
        }, errors);
      }
      continue;
    }
    if (response.content !== undefined && !isObject(response.content)) {
      errors.push(`${label}: response content must be an object`);
      continue;
    }
    for (const [mediaType, rawMedia] of Object.entries(response.content ?? {})) {
      const media = resolve(spec, rawMedia, errors, `${label}: response media ${mediaType}`);
      if (!isObject(media)) continue;
      if (media.examples !== undefined && !isObject(media.examples)) {
        errors.push(`${label}: ${mediaType} examples must be an object`);
        continue;
      }
      for (const [name, rawExample] of Object.entries(media.examples ?? {})) {
        const id = `${record.operationId}:${statusKey}:${name}`;
        const example = normalizeExample(spec, rawExample, id, errors);
        if (!example) continue;
        if (media.schema === undefined) errors.push(`${id}: response media type has no schema`);
        addCase(examples, {
          id,
          kind: "response",
          operationId: record.operationId,
          status: /^\d{3}$/u.test(statusKey) ? Number(statusKey) : statusKey,
          mediaType,
          schema: media.schema,
          body: example.value,
          headers: readHeaders(example, id, errors),
          headerDefinitions,
        }, errors);
      }
    }
  }
}

function operationRecord(spec, operationId, errors) {
  const record = operations(spec, []).find((candidate) => candidate.operationId === operationId);
  if (!record) errors.push(`operation ${operationId} does not exist`);
  return record;
}

function requestBinding(spec, example, errors) {
  const record = operationRecord(spec, example.operationId, errors);
  if (!record) return undefined;
  if (example.method !== record.method) errors.push(`method ${example.method} does not match ${record.method}`);
  if (example.path !== record.path) errors.push(`path ${example.path} does not match ${record.path}`);
  const parameters = normalizeParameters(spec, record, errors);
  const requestBody = record.operation.requestBody === undefined
    ? undefined
    : resolve(spec, record.operation.requestBody, errors, `${record.operationId}: request body`);
  if (example.body === undefined) {
    if (requestBody?.required === true) errors.push("required request body is missing");
    if (example.mediaType !== undefined) errors.push("bodyless request must not select a media type");
    return { parameters, schema: undefined };
  }
  if (typeof example.mediaType !== "string") {
    errors.push("request body has no media type");
    return { parameters, schema: undefined };
  }
  const media = resolve(spec, requestBody?.content?.[example.mediaType], errors, `${record.operationId}: request media ${example.mediaType}`);
  if (!isObject(media)) {
    errors.push(`request media type ${example.mediaType} is not declared by ${record.operationId}`);
    return { parameters, schema: undefined };
  }
  return { parameters, schema: media.schema };
}

function responseBinding(spec, example, errors) {
  const record = operationRecord(spec, example.operationId, errors);
  if (!record) return undefined;
  const status = String(example.status);
  const response = resolve(spec, record.operation.responses?.[status], errors, `${record.operationId}:${status} response`);
  if (!isObject(response)) {
    errors.push(`response status ${status} is not declared by ${record.operationId}`);
    return undefined;
  }
  if (example.status === 204) {
    if (response.content !== undefined) errors.push("204 must not declare content");
    return { headerDefinitions: responseHeaderDefinitions(spec, response, `${record.operationId}:${status}`, errors) };
  }
  const media = resolve(spec, response.content?.[example.mediaType], errors, `${record.operationId}:${status} media ${example.mediaType}`);
  if (!isObject(media)) {
    errors.push(`response media type ${example.mediaType} is not declared for ${record.operationId}:${status}`);
    return undefined;
  }
  return {
    schema: media.schema,
    headerDefinitions: responseHeaderDefinitions(spec, response, `${record.operationId}:${status}`, errors),
  };
}

function streamBinding(spec, event, errors) {
  const stream = operationRecord(spec, "streamEvents", errors);
  if (!stream) return undefined;
  const response = resolve(spec, stream.operation.responses?.["200"], errors, "streamEvents:200 response");
  const media = resolve(spec, response?.content?.["text/event-stream"], errors, "streamEvents:200 event media");
  const bindings = media?.["x-event-data-schemas"];
  if (!isObject(bindings)) {
    errors.push("streamEvents:200: text/event-stream has no x-event-data-schemas map");
    return undefined;
  }
  const ref = bindings[event];
  if (typeof ref !== "string") {
    errors.push(`streamEvents: event ${event} has no schema binding`);
    return undefined;
  }
  const schema = resolve(spec, { $ref: ref }, errors, `streamEvents: event ${event}`);
  if (schema === undefined) return undefined;
  return { schema, stream };
}

function normalizeEvents(spec, examples, errors) {
  const componentExamples = spec.components?.examples;
  if (componentExamples === undefined) return;
  if (!isObject(componentExamples)) {
    errors.push("components.examples must be an object");
    return;
  }
  for (const [name, rawExample] of Object.entries(componentExamples)) {
    const id = `event:${name}`;
    const example = normalizeExample(spec, rawExample, id, errors);
    if (!example) continue;
    const event = example["x-event"];
    if (typeof event !== "string" || event.length === 0) {
      errors.push(`${id}: x-event must be a nonempty string`);
      continue;
    }
    const binding = streamBinding(spec, event, errors);
    if (!binding) continue;
    addCase(examples, {
      id,
      kind: "event",
      operationId: binding.stream.operationId,
      method: binding.stream.method,
      path: binding.stream.path,
      status: 200,
      mediaType: "text/event-stream",
      event,
      eventId: example["x-event-id"],
      schema: binding.schema,
      body: example.value,
    }, errors);
  }
}

function schemaValidator(spec) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const cache = new Map();
  return (schema, value) => {
    if (schema === undefined) return ["schema is missing"];
    let compiled = cache.get(schema);
    if (!compiled) {
      try {
        compiled = {
          validate: ajv.compile({ ...spec, $schema: spec.jsonSchemaDialect ?? DIALECT, allOf: [schema] }),
        };
      } catch (error) {
        compiled = { error: `invalid schema: ${error.message}` };
      }
      cache.set(schema, compiled);
    }
    if (compiled.error) return [compiled.error];
    if (compiled.validate(value)) return [];
    return compiled.validate.errors.map((error) => {
      const where = error.instancePath || "/";
      return `${where} ${error.message}`;
    });
  };
}

function scalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function serializableParameter({ definition, value }) {
  if (scalar(value)) return [];
  if (Array.isArray(value) && value.every(scalar)) return [];
  return [`parameter ${definition.name} uses unsupported object or nested-array serialization`];
}

function safeHeaders(headers) {
  const errors = [];
  if (!isObject(headers)) return ["headers must be an object"];
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME.test(name)) errors.push(`invalid header name ${JSON.stringify(name)}`);
    const values = Array.isArray(value) ? value : [value];
    if (!values.every(scalar)) errors.push(`header ${name} must be a scalar or flat array`);
    else if (values.some((item) => /[\r\n]/u.test(String(item)))) errors.push(`header ${name} contains a line break`);
  }
  return errors;
}

function mediaTypeOf(value) {
  return typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : undefined;
}

/**
 * @typedef {{definition: Record<string, unknown>, value: unknown}} ExampleParameter
 * @typedef {{id:string, kind:"request", operationId:string, method:string, path:string, mediaType:string|undefined, schema:unknown, body:unknown, headers:Record<string, unknown>, parameters:ExampleParameter[]}} RequestExample
 * @typedef {{id:string, kind:"response", operationId:string, status:number|string, mediaType:string, schema:unknown, body:unknown, headers:Record<string, unknown>, headerDefinitions:Record<string, Record<string, unknown>>}} ResponseExample
 * @typedef {{id:string, kind:"event", operationId:string, method:string, path:string, status:number, mediaType:"text/event-stream", event:string, eventId?:unknown, schema:unknown, body:unknown}} EventExample
 * @typedef {RequestExample|ResponseExample|EventExample} ContractExample
 */

/** Create one normalized, schema-validator-backed view of an immutable OpenAPI document. */
export function createContract(spec) {
  const errors = [];
  const examples = new Map();
  if (!isObject(spec)) {
    return { spec, examples, errors: ["source/openapi.yaml: document must be an object"], validate: () => ["schema is unavailable"] };
  }
  if (spec.openapi !== "3.1.0") errors.push("source/openapi.yaml: openapi must be 3.1.0");
  const records = operations(spec, errors);
  for (const record of records) {
    const parameters = normalizeParameters(spec, record, errors);
    normalizeRequests(spec, record, parameters, examples, errors);
    normalizeResponses(spec, record, examples, errors);
  }
  normalizeEvents(spec, examples, errors);

  const context = { spec, examples, errors, validate: schemaValidator(spec) };
  for (const example of examples.values()) {
    errors.push(...validateExample(context, example));
  }
  return context;
}

/** Validate one normalized example without interpreting rendered HTTP or SSE text. */
export function validateExample(context, example) {
  const prefix = typeof example?.id === "string" ? `${example.id}: ` : "example: ";
  const errors = [];
  const fail = (message) => errors.push(prefix + message);
  if (!isObject(example) || !["request", "response", "event"].includes(example.kind)) {
    return [prefix + "invalid normalized example"];
  }

  if (example.kind === "request") {
    if (!METHOD.test(example.method) || typeof example.path !== "string" || /[\r\n]/u.test(example.path)) {
      fail("invalid HTTP request line fields");
    }
    for (const message of safeHeaders(example.headers)) fail(message);
    const bindingErrors = [];
    const binding = requestBinding(context.spec, example, bindingErrors);
    for (const message of bindingErrors) fail(message);
    if (example.body !== undefined && binding?.schema !== undefined) {
      for (const message of context.validate(binding.schema, example.body)) fail(`body ${message}`);
    }
    if (!Array.isArray(example.parameters)) fail("parameters must be an array");
    else if (binding) {
      const actual = new Map();
      for (const parameter of example.parameters) {
        if (isObject(parameter?.definition)) actual.set(parameterKey(parameter.definition), parameter);
        else fail("invalid normalized parameter");
      }
      for (const expected of binding.parameters) {
        const definition = expected.definition;
        let parameter = actual.get(parameterKey(definition));
        if (definition.in === "header") {
          const present = headerEntry(example.headers, definition.name);
          if (!present) {
            if (definition.required === true) fail(`missing required request header ${definition.name}`);
            continue;
          }
          parameter = { definition, value: present[1] };
        } else if (!parameter) {
          if (definition.required === true) fail(`missing required ${definition.in} parameter ${definition.name}`);
          continue;
        }
        for (const message of serializableParameter(parameter)) fail(message);
        if (definition.schema === undefined) fail(`parameter ${definition.name} has no schema`);
        else for (const message of context.validate(definition.schema, parameter.value)) fail(`parameter ${definition.name} ${message}`);
      }
    }
    const contentType = headerEntry(example.headers, "Content-Type")?.[1];
    if (contentType !== undefined && mediaTypeOf(contentType) !== example.mediaType?.toLowerCase()) {
      fail(`Content-Type ${contentType} does not match ${example.mediaType}`);
    }
  } else if (example.kind === "response") {
    const bindingErrors = [];
    const binding = responseBinding(context.spec, example, bindingErrors);
    for (const message of bindingErrors) fail(message);
    if (binding?.schema !== undefined) {
      for (const message of context.validate(binding.schema, example.body)) fail(`body ${message}`);
    }
    for (const message of safeHeaders(example.headers)) fail(message);
    const contentType = headerEntry(example.headers, "Content-Type")?.[1];
    if (example.status === 204) {
      if (example.body !== undefined || example.mediaType !== undefined || contentType !== undefined) {
        fail("204 must not have a body, media type, or Content-Type");
      }
    } else if (contentType === undefined) fail("response example is missing Content-Type");
    else if (typeof example.mediaType !== "string" || mediaTypeOf(contentType) !== example.mediaType.toLowerCase()) {
      fail(`Content-Type ${contentType} does not match ${example.mediaType}`);
    }
    for (const [name, definition] of Object.entries(binding?.headerDefinitions ?? {})) {
      const present = headerEntry(example.headers, name);
      if (definition.required === true && !present) fail(`missing required response header ${name}`);
      if (!present) continue;
      if (definition.schema === undefined) fail(`response header ${name} has no schema`);
      else for (const message of context.validate(definition.schema, present[1])) fail(`response header ${name} ${message}`);
    }
    if (example.status === 202) {
      const retry = headerEntry(example.headers, "Retry-After")?.[1];
      if (!Number.isInteger(retry) || retry < 1) fail("Retry-After must be a positive integer");
      const location = headerEntry(example.headers, "Location")?.[1];
      if (location !== example.body?.href) fail("Location must equal response body href");
    }
  } else {
    if (example.operationId !== "streamEvents" || example.status !== 200) fail("event is not bound to streamEvents:200");
    if (example.mediaType !== "text/event-stream") fail("event media type must be text/event-stream");
    if (typeof example.event !== "string" || example.event.length === 0 || /[\r\n]/u.test(example.event)) {
      fail("event must be a nonempty single-line string");
    }
    if (example.eventId !== undefined && (typeof example.eventId !== "string" || example.eventId.length === 0 || /[\u0000\r\n]/u.test(example.eventId))) {
      fail("eventId must be a nonempty string without NUL, CR or LF");
    }
    const bindingErrors = [];
    const binding = streamBinding(context.spec, example.event, bindingErrors);
    for (const message of bindingErrors) fail(message);
    if (binding) {
      if (example.method !== binding.stream.method || example.path !== binding.stream.path) fail("event operation identity changed");
      for (const message of context.validate(binding.schema, example.body)) fail(`body ${message}`);
    }
  }
  return errors;
}

function headerValue(value) {
  const values = Array.isArray(value) ? value : [value];
  if (!values.every(scalar) || values.some((item) => /[\r\n]/u.test(String(item)))) {
    throw new TypeError("header values must be line-safe scalars or flat arrays");
  }
  return values.map(String).join(", ");
}

function encoded(value) {
  if (!scalar(value)) throw new TypeError("URI parameter values must be scalars");
  return encodeURIComponent(String(value));
}

function requestParts(example) {
  let target = example.path;
  const query = [];
  const headers = { ...example.headers };
  for (const parameter of example.parameters) {
    const { definition, value } = parameter;
    const values = Array.isArray(value) ? value : [value];
    if (!values.every(scalar)) throw new TypeError(`unsupported serialization for parameter ${definition.name}`);
    if (definition.in === "path") {
      const rendered = values.map(encoded).join(",");
      const marker = `{${definition.name}}`;
      if (!target.includes(marker)) throw new TypeError(`path has no placeholder for ${definition.name}`);
      target = target.replaceAll(marker, rendered);
    } else if (definition.in === "query") {
      const name = encodeURIComponent(definition.name);
      if (definition.explode !== false && Array.isArray(value)) {
        for (const item of values) query.push(`${name}=${encoded(item)}`);
      } else {
        query.push(`${name}=${values.map(encoded).join(",")}`);
      }
    } else if (definition.in === "header") {
      if (!headerEntry(headers, definition.name)) headers[definition.name] = value;
    } else {
      throw new TypeError(`unsupported parameter location ${definition.in}`);
    }
  }
  if (/\{[^{}]+\}/u.test(target)) throw new TypeError("request path has an unresolved parameter");
  if (query.length > 0) target += `${target.includes("?") ? "&" : "?"}${query.join("&")}`;
  if (example.body !== undefined && !headerEntry(headers, "Content-Type")) headers["Content-Type"] = example.mediaType;
  return { target, headers };
}

function renderedHeaders(headers) {
  const errors = safeHeaders(headers);
  if (errors.length > 0) throw new TypeError(errors.join("; "));
  return Object.entries(headers).map(([name, value]) => `${name}: ${headerValue(value)}`).join("\n");
}
function responseRenderErrors(example) {
  const errors = safeHeaders(example.headers);
  const contentType = headerEntry(example.headers, "Content-Type")?.[1];
  if (example.status === 204) {
    if (example.body !== undefined || example.mediaType !== undefined || contentType !== undefined) {
      errors.push("204 must not have a body, media type, or Content-Type");
    }
  } else if (contentType === undefined) errors.push("response example is missing Content-Type");
  for (const [name, definition] of Object.entries(example.headerDefinitions ?? {})) {
    if (definition.required === true && !headerEntry(example.headers, name)) {
      errors.push(`missing required response header ${name}`);
    }
  }
  if (example.status === 202) {
    const retry = headerEntry(example.headers, "Retry-After")?.[1];
    if (!Number.isInteger(retry) || retry < 1) errors.push("Retry-After must be a positive integer");
    if (headerEntry(example.headers, "Location")?.[1] !== example.body?.href) {
      errors.push("Location must equal response body href");
    }
  }
  return errors;
}


/** Render a normalized case as JSON, a complete HTTP message, or one SSE event. */
export function renderExample(example, format = "json") {
  if (format === "json") return example.body === undefined ? "" : JSON.stringify(example.body, null, 2);
  if (format === "sse" || (format === "http" && example.kind === "event")) {
    if (example.kind !== "event") throw new TypeError("only event examples can be rendered as SSE");
    if (typeof example.event !== "string" || example.event.length === 0 || /[\r\n]/u.test(example.event)) {
      throw new TypeError("event must be a nonempty single-line string");
    }
    if (example.eventId !== undefined && (typeof example.eventId !== "string" || example.eventId.length === 0 || /[\u0000\r\n]/u.test(example.eventId))) {
      throw new TypeError("eventId must be a nonempty string without NUL, CR or LF");
    }
    if (example.body === undefined) throw new TypeError("event body is required");
    const lines = [];
    if (example.eventId !== undefined) lines.push(`id: ${example.eventId}`);
    lines.push(`event: ${example.event}`, `data: ${JSON.stringify(example.body)}`);
    return `${lines.join("\n")}\n\n`;
  }
  if (format !== "http") throw new TypeError(`unsupported example format ${format}`);
  if (example.kind === "request") {
    if (!METHOD.test(example.method) || /[\r\n]/u.test(example.path)) throw new TypeError("invalid HTTP request line fields");
    const { target, headers } = requestParts(example);
    const body = example.body === undefined ? "" : JSON.stringify(example.body, null, 2);
    return `${example.method} ${target} HTTP/1.1\n${renderedHeaders(headers)}\n\n${body}`;
  }
  const responseErrors = responseRenderErrors(example);
  if (responseErrors.length > 0) throw new TypeError(responseErrors.join("; "));
  if (!Number.isInteger(example.status) || example.status < 100 || example.status > 599) {
    throw new TypeError("HTTP response status must be an integer from 100 to 599");
  }
  const reason = STATUS_CODES[example.status] ?? "";
  const body = example.body === undefined ? "" : JSON.stringify(example.body, null, 2);
  return `HTTP/1.1 ${example.status}${reason ? ` ${reason}` : ""}\n${renderedHeaders(example.headers)}\n\n${body}`;
}
