const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Validate causal invariants that JSON Schema cannot express for one FlowDetail value. */
export function validateFlowTrace(flow) {
  const errors = [];
  const trace = flow?.trace;
  if (!isObject(trace) || !Array.isArray(trace.steps)) return errors;

  const complete = trace.status === "complete";
  if (trace.status === "partial" && (!Array.isArray(trace.missing) || trace.missing.length === 0)) {
    errors.push("partial trace must name at least one missing evidence source");
  }
  if (complete && Array.isArray(trace.missing) && trace.missing.length > 0) {
    errors.push("complete trace must not name missing evidence sources");
  }

  const evaluations = new Map();
  const attempts = new Set();
  const lookups = new Set();
  const attemptParents = new Map();
  const lookupParents = new Map();
  const attemptOwners = new Map();

  const addParent = (parents, id, parent) => {
    if (typeof id !== "string" || typeof parent !== "string") return;
    const values = parents.get(id) ?? new Set();
    values.add(parent);
    parents.set(id, values);
  };

  for (const step of trace.steps) {
    const data = isObject(step?.data) ? step.data : {};
    if (step?.stage === "route" && typeof data.evaluation_id === "string") {
      if (evaluations.has(data.evaluation_id)) errors.push(`duplicate route evaluation ID ${data.evaluation_id}`);
      else evaluations.set(data.evaluation_id, step);
    } else if (step?.stage === "outbound" && typeof data.attempt_id === "string") {
      attempts.add(data.attempt_id);
      const owner = JSON.stringify([data.parent_attempt_id, data.routing_source, data.evaluation_id]);
      if (attemptOwners.has(data.attempt_id) && attemptOwners.get(data.attempt_id) !== owner) {
        errors.push(`outbound attempt ${data.attempt_id} changes its parent or route evaluation`);
      } else {
        attemptOwners.set(data.attempt_id, owner);
      }
      addParent(attemptParents, data.attempt_id, data.parent_attempt_id);
    } else if (step?.stage === "dns" && typeof data.lookup_id === "string") {
      lookups.add(data.lookup_id);
      addParent(lookupParents, data.lookup_id, data.parent_lookup_id);
    }
  }

  const requireReference = (ids, id, kind, step) => {
    if (complete && id !== null && id !== undefined && !ids.has(id)) {
      errors.push(`complete trace ${step.stage} step ${step.seq} has unresolved ${kind} ${id}`);
    }
  };

  for (const step of trace.steps) {
    const data = isObject(step?.data) ? step.data : {};
    if (step?.stage === "route") {
      if (complete && data.input === null) {
        errors.push(`complete trace route evaluation ${data.evaluation_id ?? "<missing>"} has no captured input context`);
      }
      if (complete && ["dns_request", "dns_response"].includes(data.chain) && data.dns_action === null) {
        errors.push(`complete trace route evaluation ${data.evaluation_id ?? "<missing>"} has no observed DNS action`);
      }
    } else if (step?.stage === "outbound") {
      if (complete && data.routing_source === "unknown") {
        errors.push(`complete trace outbound attempt ${data.attempt_id ?? "<missing>"} has unknown routing source`);
      }
      requireReference(evaluations, data.evaluation_id, "route evaluation", step);
      requireReference(attempts, data.parent_attempt_id, "parent attempt", step);
    } else if (step?.stage === "dns") {
      requireReference(attempts, data.attempt_id, "attempt", step);
      requireReference(lookups, data.parent_lookup_id, "parent DNS lookup", step);
      if (Array.isArray(data.route_evaluation_ids)) {
        for (const id of data.route_evaluation_ids) requireReference(evaluations, id, "route evaluation", step);
      }
    } else if (step?.stage === "reroute") {
      if (complete && data.performed === true && (data.from_evaluation_id === null || data.to_evaluation_id === null)) {
        errors.push(`performed reroute step ${step.seq} requires both route evaluation endpoints`);
      }
      if (data.performed === true && typeof data.from_evaluation_id === "string" && data.from_evaluation_id === data.to_evaluation_id) {
        errors.push(`performed reroute step ${step.seq} cannot reuse one evaluation for both passes`);
      }
      requireReference(evaluations, data.from_evaluation_id, "source route evaluation", step);
      requireReference(evaluations, data.to_evaluation_id, "target route evaluation", step);
    } else if (step?.stage === "connection") {
      requireReference(attempts, data.attempt_id, "attempt", step);
    }
  }

  const hasCycle = (ids, parents) => {
    const visited = new Set();
    const active = new Set();
    const visit = (id) => {
      if (active.has(id)) return true;
      if (visited.has(id)) return false;
      active.add(id);
      for (const parent of parents.get(id) ?? []) {
        if (ids.has(parent) && visit(parent)) return true;
      }
      active.delete(id);
      visited.add(id);
      return false;
    };
    return [...ids].some(visit);
  };

  if (hasCycle(attempts, attemptParents)) errors.push("outbound attempt parent links contain a cycle");
  if (hasCycle(lookups, lookupParents)) errors.push("DNS lookup parent links contain a cycle");
  return errors;
}
