// Meta's structured output honours only the first branch of a union (anyOf or oneOf): measured live on 2 Nov 2026,
// "add two phone booths" against a two-branch union came back as the first branch with an empty room, every time.
// So a union whose branches are told apart by a fixed value (zod's discriminated union) is sent as one object: the
// discriminator lists every value, and every other field is required, described by the branches that use it. The
// answer is cut back to the chosen branch's fields before the zod type checks it, so callers see no difference.

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The discriminator key and its value per branch, when every branch is an object with one shared const field. */
function discriminated(branches: unknown[]): { key: string; values: string[] } | undefined {
  const objects = branches.filter(isNode);
  if (objects.length < 2 || objects.length !== branches.length) return undefined;
  const props = objects.map((branch) => (isNode(branch.properties) ? branch.properties : {}));
  const first = props[0] ?? {};
  for (const key of Object.keys(first)) {
    const values = props.map((p) => (isNode(p[key]) ? p[key].const : undefined));
    if (values.every((v) => typeof v === "string") && new Set(values).size === values.length)
      return { key, values: values as string[] };
  }
  return undefined;
}

/** Loosen a field shared by several branches: bounds differ between branches, and a filler must be allowed. */
function loosened(field: unknown): unknown {
  if (!isNode(field)) return field;
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, minLength, maxLength, ...rest } =
    field;
  void [minimum, maximum, exclusiveMinimum, exclusiveMaximum, minLength, maxLength];
  return rest;
}

/** The JSON Schema with every discriminated union merged into one object. */
export function flattenUnions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(flattenUnions);
  if (!isNode(node)) return node;
  const branches = (node.anyOf ?? node.oneOf) as unknown[] | undefined;
  const tag = Array.isArray(branches) ? discriminated(branches) : undefined;
  if (branches && tag) {
    const properties: Node = { [tag.key]: { type: "string", enum: tag.values } };
    const users = new Map<string, string[]>();
    branches.forEach((branch, i) => {
      const props = (branch as Node).properties as Node;
      for (const [key, field] of Object.entries(props)) {
        if (key === tag.key) continue;
        users.set(key, [...(users.get(key) ?? []), tag.values[i] as string]);
        properties[key] ??= flattenUnions(loosened(field));
      }
    });
    for (const [key, ops] of users) {
      const field = properties[key] as Node;
      const filler = field.type === "number" || field.type === "integer" ? "0" : '""';
      properties[key] = {
        ...field,
        description: `${field.description ? `${field.description} ` : ""}Used by ${ops.join(", ")}; otherwise ${filler}.`,
      };
      if (Array.isArray(field.enum) && field.type === "string")
        properties[key] = { ...(properties[key] as Node), enum: [...field.enum, ""] };
    }
    return {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    };
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, flattenUnions(v)]));
}

/** Cut an answer to a flattened schema back to the fields of the branch it chose. */
export function unflatten(schema: unknown, data: unknown): unknown {
  if (!isNode(schema)) return data;
  const branches = (schema.anyOf ?? schema.oneOf) as unknown[] | undefined;
  const tag = Array.isArray(branches) ? discriminated(branches) : undefined;
  if (branches && tag && isNode(data)) {
    const branch = branches[tag.values.indexOf(String(data[tag.key]))] as Node | undefined;
    if (!branch) return data;
    const props = branch.properties as Node;
    const required = new Set((branch.required as string[] | undefined) ?? []);
    const kept: Node = {};
    for (const [key, field] of Object.entries(props)) {
      if (!(key in data)) continue;
      const value = data[key];
      // A field this branch only may have, left at the filler: the model meant "not given".
      if (!required.has(key) && (value === 0 || value === "" || value === null)) continue;
      kept[key] = unflatten(field, value);
    }
    return kept;
  }
  if (Array.isArray(data) && isNode(schema.items))
    return data.map((item) => unflatten(schema.items, item));
  if (isNode(data) && isNode(schema.properties)) {
    const props = schema.properties;
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, k in props ? unflatten(props[k], v) : v]),
    );
  }
  return data;
}
