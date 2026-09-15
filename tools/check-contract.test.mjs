import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";
import { createContract, renderExample, validateExample } from "./contract.mjs";
import { validateFlowTrace } from "./validate-flow.mjs";

const spec = parse(await readFile(new URL("../source/openapi.yaml", import.meta.url), "utf8"));
const contract = createContract(spec);

function example(key) {
  const value = contract.examples.get(key);
  assert.ok(value, `missing canonical example ${key}`);
  return structuredClone(value);
}

function assertValid(errors, label = "expected valid data") {
  assert.deepEqual(errors, [], label);
}

function assertInvalid(errors, label = "invalid data passed") {
  assert.ok(errors.length > 0, label);
}

function step(flow, stage, predicate = () => true) {
  const value = flow.trace.steps.find((candidate) => candidate.stage === stage && predicate(candidate.data));
  assert.ok(value, `missing ${stage} step`);
  return value;
}

function setPath(value, dottedPath, replacement) {
  const parts = dottedPath.split(".");
  const owner = parts.slice(0, -1).reduce((current, part) => current[part], value);
  owner[parts.at(-1)] = replacement;
}

test("the bundled contract and every named example are valid", () => {
  assertValid(contract.errors, "invalid bundled contract");
  for (const [key, value] of contract.examples) {
    assertValid(validateExample(contract, value), key);
  }
});

test("refined nullable objects stay open for client generators", () => {
  assert.deepEqual([
    spec.components.schemas.OperationCommon.properties.result.additionalProperties,
    spec.components.schemas.RouteStepData.properties.input.additionalProperties,
  ], [true, true]);
});

test("connection examples preserve totals and linked flow identity", () => {
  const connections = example("listConnections:200:visible").body;
  if (!connections.truncated) {
    assert.equal(connections.total_tcp, connections.tcp.length);
    assert.equal(connections.total_udp, connections.udp.length);
  }
  const connection = connections.tcp.find((entry) => entry.flow_id !== null);
  assert.ok(connection);
  const listed = example("listFlows:200:visible").body;
  const summary = listed.flows.find((flow) => flow.id === connection.flow_id);
  assert.ok(summary);
  const detail = example("getFlow:200:partial_handoff").body;
  assert.equal(listed.instance_id, connections.instance_id);
  for (const flow of [summary, detail]) {
    assert.equal(flow.id, connection.flow_id);
    assert.equal(flow.instance_id, connections.instance_id);
    assert.equal(flow.connection_id, connection.id);
    assert.equal(flow.started_at, connection.started_at);
  }
  assert.equal(detail.input.src, connection.src);
  assert.equal(detail.input.dst, connection.dst);
  assert.equal(detail.input.domain, connection.domain);
  const unrelated = example("getFlow:200:interleaved_dns").body;
  assert.notEqual(unrelated.id, detail.id);
  assert.notEqual(unrelated.connection_id, connection.id);
});

test("connection and flow-summary examples carry required list-view evidence", () => {
  const fields = ["chain", "chain_source", "rule_id", "rule_expression", "rule_source", "ingress", "domain_source"];
  const sources = {
    chain_source: ["evaluation", "reconstructed", "unknown"],
    rule_source: ["kernel", "recomputed", "unknown"],
  };
  const selectors = {
    listConnections: (body) => [...body.tcp, ...body.udp],
    listFlows: (body) => body.flows,
    getFlow: (body) => [body],
  };
  const seen = new Set();
  for (const response of contract.examples.values()) {
    const select = selectors[response.operationId];
    if (response.kind !== "response" || response.status !== 200 || !select) continue;
    const schema = { $ref: `#/components/schemas/${response.operationId === "listConnections" ? "Connection" : "FlowSummary"}` };
    for (const row of select(response.body)) {
      seen.add(response.operationId);
      for (const field of fields) {
        assert.ok(Object.hasOwn(row, field), `${response.id} ${row.id} lacks ${field}`);
        const missing = structuredClone(row);
        delete missing[field];
        assertInvalid(contract.validate(schema, missing), `${field} must be required`);
      }
      assert.ok(Array.isArray(row.chain) && row.chain.every((id) => typeof id === "string"));
      for (const [field, values] of Object.entries(sources)) {
        assert.ok(values.includes(row[field]), `${response.id} has invalid ${field}`);
        assertInvalid(contract.validate(schema, { ...row, [field]: "invalid" }));
      }
      assert.ok(["lan", "wan", null].includes(row.ingress));
      assert.ok(row.domain_source === null || spec.components.schemas.DomainSource.enum.includes(row.domain_source));
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(selectors).sort());
});

test("linked list evidence agrees with the application flow rather than DNS attempts", () => {
  const connection = example("listConnections:200:visible").body.tcp[0];
  const summary = example("listFlows:200:visible").body.flows[0];
  const detail = example("getFlow:200:partial_handoff").body;
  for (const field of ["chain", "chain_source", "rule_id", "rule_expression", "rule_source", "ingress", "domain_source"]) {
    assert.deepEqual(connection[field], summary[field], field);
    assert.deepEqual(summary[field], detail[field], field);
  }
  for (const key of ["getFlow:200:partial_handoff", "getFlow:200:interleaved_dns"]) {
    const flow = example(key).body;
    const outbound = step(flow, "outbound", (data) => data.target === flow.input.domain + ":443").data;
    assert.deepEqual(flow.chain, [...outbound.selection_path.map((item) => item.group_id), outbound.leaf_node_id]);
    assert.equal(flow.ingress, flow.input.ingress);
    assert.equal(flow.domain_source, flow.input.domain_source);
    const route = step(flow, "route", (data) => data.evaluation_id === outbound.evaluation_id).data;
    assert.equal(flow.rule_id, route.rule_id);
  }
});

test("outbound counters retain uint64 totals and a numeric active count", () => {
  const response = example("getRuntimeOutbounds:200:snapshot");
  const row = response.body.outbounds[0];
  for (const field of ["total_connections", "upload_bytes", "download_bytes", "errors"]) {
    row[field] = "18446744073709551615";
    assertValid(validateExample(contract, response));
    row[field] = 0;
    assertInvalid(validateExample(contract, response), `${field} accepted a JSON number`);
    row[field] = "0";
  }
  row.active_connections = 9007199254740991;
  assertValid(validateExample(contract, response));
  row.active_connections = "0";
  assertInvalid(validateExample(contract, response));
  row.active_connections = 0;
  row.kind = "invalid";
  assertInvalid(validateExample(contract, response));
  row.kind = "builtin";
  delete response.body.counter_since;
  assertInvalid(validateExample(contract, response));
});

test("traffic history preserves gaps, timestamps, and safe numeric boundaries", () => {
  const response = example("getTrafficHistory:200:recent");
  const sample = response.body.samples[0];
  sample.upload_bytes_per_second = null;
  sample.download_bytes_per_second = null;
  sample.connections = null;
  assertValid(validateExample(contract, response));
  sample.upload_bytes_per_second = "18446744073709551615";
  sample.download_bytes_per_second = "18446744073709551615";
  sample.connections = 9007199254740991;
  assertValid(validateExample(contract, response));
  for (const field of ["upload_bytes_per_second", "download_bytes_per_second", "connections"]) {
    const valid = sample[field];
    sample[field] = field === "connections" ? "0" : 0;
    assertInvalid(validateExample(contract, response), `${field} accepted the wrong numeric type`);
    sample[field] = valid;
  }
  delete sample.sampled_at;
  assertInvalid(validateExample(contract, response));
  response.body.samples = [];
  assertValid(validateExample(contract, response));
  response.body.sampled_every_seconds = 0;
  assertInvalid(validateExample(contract, response));
});

test("traffic history advertises usable limits and rejects invalid query shapes", () => {
  const capabilities = example("getCapabilities:200:available");
  const limits = capabilities.body.resources.traffic_history;
  assert.equal(typeof capabilities.body.resources.runtime_outbounds.available, "boolean");
  assert.equal(limits.available, true);
  for (const field of ["max_window_seconds", "max_points"]) {
    const value = limits[field];
    delete limits[field];
    assertInvalid(validateExample(contract, capabilities), `${field} must be advertised when available`);
    limits[field] = 0;
    assertInvalid(validateExample(contract, capabilities));
    limits[field] = value;
  }
  const request = example("getTrafficHistory:request");
  for (const name of ["window_seconds", "max_points"]) {
    const parameter = request.parameters.find((item) => item.definition.name === name);
    assert.ok(parameter, `missing ${name} query parameter`);
    const value = parameter.value;
    parameter.value = 0;
    assertInvalid(validateExample(contract, request));
    parameter.value = value;
  }
  const history = example("getTrafficHistory:200:recent").body;
  assert.ok(history.window_seconds <= limits.max_window_seconds);
  assert.ok(history.samples.length <= limits.max_points);
  for (const key of ["window_too_large", "too_many_points"]) {
    const rejected = example(`getTrafficHistory:400:${key}`);
    assert.equal(rejected.body.error.code, "invalid_request");
    assertValid(validateExample(contract, rejected));
  }
});

test("examples remain bound to their operation schema", () => {
  const changed = structuredClone(spec);
  changed.paths["/api/v1/flows/{flow_id}"].get.responses["200"].content[
    "application/json"
  ].schema = { $ref: "#/components/schemas/Runtime" };
  assertInvalid(createContract(changed).errors);
});

test("required path, query, and header parameters need native examples", () => {
  const mutations = [
    (changed) => delete changed.components.parameters.FlowId.example,
    (changed) => {
      const parameter = changed.paths["/api/v1/dns/query"].get.parameters.find(
        (candidate) => candidate.name === "domain",
      );
      assert.ok(parameter);
      delete parameter.example;
    },
    (changed) => delete changed.components.parameters.IfMatch.example,
  ];

  for (const mutate of mutations) {
    const changed = structuredClone(spec);
    mutate(changed);
    assertInvalid(createContract(changed).errors);
  }
});

test("unsupported parameter serialization is rejected explicitly", () => {
  const changed = structuredClone(spec);
  const parameter = changed.paths["/api/v1/dns/query"].get.parameters.find(
    (candidate) => candidate.name === "domain",
  );
  assert.ok(parameter);
  parameter.style = "deepObject";
  assertInvalid(createContract(changed).errors);
});

test("required request headers are checked case-insensitively", () => {
  const missing = example("patchGroup:request:tolerance");
  delete missing.headers["If-Match"];
  assertInvalid(validateExample(contract, missing));

  const lowerCase = example("patchGroup:request:tolerance");
  lowerCase.headers["if-match"] = lowerCase.headers["If-Match"];
  delete lowerCase.headers["If-Match"];
  assertValid(validateExample(contract, lowerCase));
});

test("202 response headers must be declared, present, typed, and causal", () => {
  const undeclared = structuredClone(spec);
  delete undeclared.paths["/api/v1/probes"].post.responses["202"].headers["Retry-After"];
  assertInvalid(createContract(undeclared).errors, "missing Retry-After declaration passed");

  const missing = example("createProbe:202:queued");
  delete missing.headers["Retry-After"];
  assertInvalid(validateExample(contract, missing), "missing Retry-After value passed");
  assert.throws(() => renderExample(missing, "http"));

  const wrongType = example("createProbe:202:queued");
  wrongType.headers["Retry-After"] = "1";
  assertInvalid(validateExample(contract, wrongType), "string Retry-After passed");

  const wrongLocation = example("createProbe:202:queued");
  wrongLocation.headers.Location = "/api/v1/operations/different-operation";
  assertInvalid(validateExample(contract, wrongLocation), "unrelated Location passed");
});

test("probe queue-full responses require a positive Retry-After", () => {
  const response = example("createProbe:503:queue_full");
  assertValid(validateExample(contract, response));
  assert.match(renderExample(response, "http"), /^HTTP\/1\.1 503 Service Unavailable\n/u);

  const missing = structuredClone(response);
  delete missing.headers["Retry-After"];
  assertInvalid(validateExample(contract, missing));
  assert.throws(() => renderExample(missing, "http"));

  const zero = structuredClone(response);
  zero.headers["Retry-After"] = 0;
  assertInvalid(validateExample(contract, zero));
});

test("response status and media type cannot be rebound", () => {
  const wrongStatus = example("createProbe:202:queued");
  wrongStatus.status = 200;
  assertInvalid(validateExample(contract, wrongStatus));

  const wrongMedia = example("createProbe:202:queued");
  wrongMedia.mediaType = "text/plain";
  assertInvalid(validateExample(contract, wrongMedia));
});

test("an ordinary response property named schema is not contract metadata", () => {
  const response = example("getRuntime:200:snapshot");
  response.body.schema = { future_adapter: true };
  assertValid(validateExample(contract, response));
});

test("SSE event names select their authoritative payload schema", () => {
  const event = example("event:FlowUpdated");

  const wrongBinding = structuredClone(event);
  wrongBinding.event = "flow.gap";
  assertInvalid(validateExample(contract, wrongBinding), "event/schema binding mismatch passed");

  const flowGap = {
    instance_id: "instance-7",
    observed_at: "2026-09-14T10:00:00Z",
    resource_id: null,
    reason: "buffer_overflow",
    dropped_records: "1",
  };
  const flowGapSchema = spec.paths["/api/v1/events"].get.responses["200"].content[
    "text/event-stream"
  ]["x-event-data-schemas"]["flow.gap"];
  assertValid(contract.validate({ $ref: flowGapSchema }, flowGap));

  const wrongPayload = structuredClone(event);
  wrongPayload.body = flowGap;
  assertInvalid(validateExample(contract, wrongPayload), "wrong selected payload passed");
});

test("rendering rejects header and SSE field injection", () => {
  const response = example("createProbe:202:queued");
  response.headers.Location += "\r\nInjected: true";
  assert.throws(() => renderExample(response, "http"));

  const badEvent = example("event:FlowUpdated");
  badEvent.event += "\nevent: flow.gap";
  assert.throws(() => renderExample(badEvent, "http"));

  const badId = example("event:FlowUpdated");
  badId.eventId += "\r\nretry: 0";
  assert.throws(() => renderExample(badId, "http"));

  const nulId = example("event:FlowUpdated");
  nulId.eventId += "\u0000ignored";
  assertInvalid(validateExample(contract, nulId));
  assert.throws(() => renderExample(nulId, "sse"));
});

test("JSON and HTTP renderers expose the canonical wire values", () => {
  const body = example("createProbe:request:dns_udp");
  assert.deepEqual(JSON.parse(renderExample(body)), body.body);

  const query = renderExample(example("queryDns:request"), "http");
  assert.match(query, /^GET \/api\/v1\/dns\/query\?/u);
  assert.match(query, /(?:\?|&)domain=example\.com(?:&| )/u);
  assert.match(query, /(?:\?|&)type=A&type=AAAA(?:&| )/u);

  const pathRequest = renderExample(example("getFlow:request"), "http");
  assert.match(pathRequest, /^GET \/api\/v1\/flows\/flow-23 HTTP\/1\.1(?:\r?\n|$)/u);

  const accepted = renderExample(example("createProbe:202:queued"), "http");
  assert.match(accepted, /^HTTP\/1\.1 202 Accepted(?:\r?\n)/u);
  assert.match(accepted, /(?:^|\r?\n)Location: \/api\/v1\/operations\/op-01HZX4K8W9(?:\r?\n)/u);
  assert.match(accepted, /(?:^|\r?\n)Retry-After: 1(?:\r?\n)/u);
  assert.match(accepted, /\r?\n\r?\n/u);
});

test("native EventSource observes emitted and legal alternate SSE framing", { timeout: 3_000 }, async () => {
  assert.equal(typeof EventSource, "function", "run Node with --experimental-eventsource");
  const event = example("event:FlowUpdated");
  const emitted = renderExample(event, "http");
  assert.equal(
    emitted,
    `id: ${event.eventId}\nevent: ${event.event}\ndata: ${JSON.stringify(event.body)}\n\n`,
  );

  const lateEvent = `data:${JSON.stringify(event.body)}\nevent:${event.event}\nid: late\n\n`;
  const multiData = [
    `event: ${event.event}`,
    "id: multiline",
    ...JSON.stringify(event.body, null, 2)
      .split("\n")
      .map((line, index) => `data:${index % 2 ? " " : ""}${line}`),
    "",
    "",
  ].join("\r\n");

  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "close",
    });
    response.end(emitted + lateEvent + multiData);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  let source;
  try {
    const address = server.address();
    assert.notEqual(address, null);
    source = new EventSource(`http://127.0.0.1:${address.port}/events`);
    const received = await new Promise((resolve, reject) => {
      const values = [];
      const timer = setTimeout(() => reject(new Error("timed out waiting for SSE frames")), 2_000);
      source.addEventListener(event.event, (message) => {
        values.push({ id: message.lastEventId, body: JSON.parse(message.data) });
        if (values.length === 3) {
          clearTimeout(timer);
          resolve(values);
        }
      });
      source.addEventListener("error", (error) => {
        clearTimeout(timer);
        reject(error);
      }, { once: true });
    });
    assert.deepEqual(received, [
      { id: event.eventId, body: event.body },
      { id: "late", body: event.body },
      { id: "multiline", body: event.body },
    ]);
  } finally {
    source?.close();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("request targets stay closed while response targets remain additive", () => {
  const request = example("createProbe:request:dns_udp");
  request.body.target.display_name = "future response metadata";
  assertInvalid(validateExample(contract, request));

  const response = example("getOperation:200:probe_complete");
  response.body.result.target.display_name = "adapter-provided label";
  assertValid(validateExample(contract, response));

  const tcp = example("createProbe:request:dns_udp");
  Object.assign(tcp.body, { kind: "tcp_connect", purpose: "data", transport: ["tcp"] });
  assertValid(validateExample(contract, tcp));

  const wrongPurpose = structuredClone(tcp);
  wrongPurpose.body.purpose = "dns";
  assertInvalid(validateExample(contract, wrongPurpose));

  const wrongTransport = structuredClone(tcp);
  wrongTransport.body.transport = ["udp"];
  assertInvalid(validateExample(contract, wrongTransport));
});

test("runtime counters preserve nullable and numeric connection semantics", () => {
  const nullable = example("getRuntime:200:snapshot");
  for (const name of ["tcp", "udp", "total"]) nullable.body.traffic.connections[name] = null;
  nullable.body.traffic.bytes.upload = null;
  nullable.body.traffic.bytes.download = null;
  nullable.body.traffic.rates.upload_bytes_per_second = null;
  nullable.body.traffic.rates.download_bytes_per_second = null;
  assertValid(validateExample(contract, nullable));

  const zero = example("getRuntime:200:snapshot");
  for (const name of ["tcp", "udp", "total"]) zero.body.traffic.connections[name] = 0;
  assertValid(validateExample(contract, zero));

  const wrongType = example("getRuntime:200:snapshot");
  wrongType.body.traffic.connections.tcp = "0";
  assertInvalid(validateExample(contract, wrongType));
});

test("runtime memory may omit unadvertised metrics", () => {
  const memory = example("getRuntimeMemory:200:snapshot");
  delete memory.body.process.rss_bytes;
  delete memory.body.cgroup.current_bytes;
  delete memory.body.cgroup.limit_bytes;
  delete memory.body.cgroup.events;
  delete memory.body.kernel.ebpf_bytes;
  assertValid(validateExample(contract, memory));
});

test("flow snapshots advertise a schema-valid 503 response", () => {
  assertValid(validateExample(contract, example("listFlows:503:snapshot_full")));
});

test("uint64 decimal strings preserve exact limits at every current consumer", () => {
  const uint64 = { $ref: "#/components/schemas/UInt64" };
  const nullable = { $ref: "#/components/schemas/NullableUInt64" };
  for (const value of ["0", "9007199254740992", "18446744073709551615"]) {
    assertValid(contract.validate(uint64, value));
  }
  assertValid(contract.validate(nullable, null));
  for (const value of [
    0,
    9007199254740992,
    "-1",
    "+1",
    "01",
    "1e3",
    "1 ",
    "1\t",
    "1\n",
    "18446744073709551616",
  ]) {
    assertInvalid(contract.validate(uint64, value), `${JSON.stringify(value)} passed as uint64`);
  }

  const max = "18446744073709551615";
  const consumers = [
    ["getRuntime:200:snapshot", [
      "lifecycle.uptime_seconds",
      "traffic.bytes.upload",
      "traffic.bytes.download",
      "traffic.rates.upload_bytes_per_second",
      "traffic.rates.download_bytes_per_second",
    ]],
    ["getRuntimeMemory:200:snapshot", [
      "process.rss_bytes",
      "cgroup.current_bytes",
      "cgroup.limit_bytes",
      "cgroup.events.high",
      "cgroup.events.oom",
      "cgroup.events.oom_kill",
      "kernel.ebpf_bytes",
    ]],
    ["listConnections:200:visible", [
      "tcp.0.upload_bytes",
      "tcp.0.download_bytes",
      "tcp.0.upload_bytes_per_second",
      "tcp.0.download_bytes_per_second",
    ]],
    ["listFlows:200:visible", ["dropped_records"]],
  ];
  for (const [key, fields] of consumers) {
    const response = example(key);
    for (const field of fields) setPath(response.body, field, max);
    assertValid(validateExample(contract, response), key);
  }

  assertValid(contract.validate(
    { $ref: "#/components/schemas/FlowGapEvent" },
    {
      instance_id: "instance-7",
      observed_at: "2026-09-14T10:00:00Z",
      resource_id: null,
      reason: "buffer_overflow",
      dropped_records: max,
    },
  ));
});

test("the interleaved DNS flow preserves chain-specific input and port zero", () => {
  const response = example("getFlow:200:interleaved_dns");
  assertValid(validateExample(contract, response));
  assertValid(validateFlowTrace(response.body));
  const upstream = step(response.body, "route", (data) => data.chain === "dns_upstream");
  assert.equal(upstream.data.input.src_port, 0);

  const missingNetwork = example("getFlow:200:interleaved_dns");
  delete step(missingNetwork.body, "route", (data) => data.chain === "dns_upstream").data.input.network;
  assertInvalid(validateExample(contract, missingNetwork));

  const nonPort = example("getFlow:200:interleaved_dns");
  step(nonPort.body, "route", (data) => data.chain === "dns_upstream").data.input.src_port = 65_536;
  assertInvalid(validateExample(contract, nonPort));

  const swapped = example("getFlow:200:interleaved_dns");
  const request = step(swapped.body, "route", (data) => data.chain === "dns_request");
  const responseRoute = step(swapped.body, "route", (data) => data.chain === "dns_response");
  [request.data.input, responseRoute.data.input] = [responseRoute.data.input, request.data.input];
  assertInvalid(validateExample(contract, swapped));
});

test("partial traces retain unresolved references while complete traces reject them", () => {
  const complete = example("getFlow:200:interleaved_dns");
  step(complete.body, "outbound", (data) => data.attempt_id === "attempt-app").data.evaluation_id =
    "evaluation-missing";
  assertValid(contract.validate(complete.schema, complete.body));
  assertInvalid(validateFlowTrace(complete.body));

  const partial = structuredClone(complete);
  partial.body.trace_status = "partial";
  partial.body.trace.status = "partial";
  partial.body.trace.missing = ["not_instrumented"];
  assertValid(validateExample(contract, partial));
  assertValid(validateFlowTrace(partial.body));

  const unexplainedLoss = example("getFlow:200:interleaved_dns");
  unexplainedLoss.body.trace_status = "partial";
  unexplainedLoss.body.trace.status = "partial";
  assertInvalid(validateFlowTrace(unexplainedLoss.body));
});

test("flow IDs, ownership, and parent graphs remain causal", () => {
  const duplicate = example("getFlow:200:interleaved_dns").body;
  const duplicateRoute = structuredClone(step(duplicate, "route", (data) => data.chain === "traffic"));
  duplicateRoute.seq = 8;
  duplicate.trace.steps.push(duplicateRoute);
  assertInvalid(validateFlowTrace(duplicate));

  const changedOwner = example("getFlow:200:interleaved_dns").body;
  const repeatedAttempt = structuredClone(
    step(changedOwner, "outbound", (data) => data.attempt_id === "attempt-dns"),
  );
  repeatedAttempt.seq = 8;
  repeatedAttempt.data.evaluation_id = "eval-traffic";
  changedOwner.trace.steps.push(repeatedAttempt);
  assertInvalid(validateFlowTrace(changedOwner));

  const attemptCycle = example("getFlow:200:interleaved_dns").body;
  step(attemptCycle, "outbound", (data) => data.attempt_id === "attempt-dns").data.parent_attempt_id =
    "attempt-app";
  step(attemptCycle, "outbound", (data) => data.attempt_id === "attempt-app").data.parent_attempt_id =
    "attempt-dns";
  assertInvalid(validateFlowTrace(attemptCycle));

  const lookupCycle = example("getFlow:200:interleaved_dns").body;
  const dns = step(lookupCycle, "dns");
  dns.data.parent_lookup_id = dns.data.lookup_id;
  assertInvalid(validateFlowTrace(lookupCycle));
});

test("complete traces require known routing sources and DNS actions", () => {
  const unknownSource = example("getFlow:200:interleaved_dns").body;
  step(unknownSource, "outbound", (data) => data.attempt_id === "attempt-app").data.routing_source =
    "unknown";
  assertInvalid(validateFlowTrace(unknownSource));

  const missingAction = example("getFlow:200:interleaved_dns").body;
  step(missingAction, "route", (data) => data.chain === "dns_request").data.dns_action = null;
  assertInvalid(validateFlowTrace(missingAction));
});

test("partial reroutes may report an uncaptured source", () => {
  const response = example("getFlow:200:partial_handoff");
  const reroute = step(response.body, "reroute");
  Object.assign(reroute.data, {
    performed: true,
    reason: "sniffed_domain",
    from_evaluation_id: null,
    to_evaluation_id: "eval-1",
  });
  step(response.body, "route").data.plane = "userspace";
  const mode = step(response.body, "dial_mode");
  mode.data.configured = "domain++";
  mode.data.reason = "sniffed_domain";
  assertValid(validateExample(contract, response));
  assertValid(validateFlowTrace(response.body));
});
