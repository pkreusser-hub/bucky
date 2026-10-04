// A Firestore REST stand-in that refuses what the real service refuses (CLAUDE.md: "a fixture
// kinder than reality hides bugs"). Shared by tools/_verify-leaguecron.mjs and
// tools/_verify-lineupwarn.mjs. In-memory documents, keyed by "collection/docId".
//
// What it enforces, each of which the real REST API does:
//   - PATCH needs an updateMask on every write (the house rule is masked writes only). A body field
//     outside the mask is a 400 here — STRICTER than the service, which silently ignores it,
//     on purpose: such a body is always a bug. A masked path the body omits deletes that field,
//     as the real service does.
//   - field paths must be plain identifiers (a dash or a dot unquoted is a 400)
//   - every value carries exactly one known type key; integerValue must be a decimal STRING
//     (a JS number is a 400 "Invalid value"); doubleValue must be a number; arrayValue/mapValue
//     recurse; timestampValue/stringValue/booleanValue/nullValue are type-checked
//   - currentDocument.exists=false on an existing doc -> 409 ALREADY_EXISTS
//   - currentDocument.exists=true on a missing doc    -> 404 NOT_FOUND
//   - currentDocument.updateTime that is not the doc's -> 400 FAILED_PRECONDITION
//   - document ids with a "/" or the reserved "." / ".." shapes are 400
//   - GET of a missing doc is a 404 with the {error:{status:"NOT_FOUND"}} body
//   - a document may not exceed 1 MiB (the real limit)
//   - runQuery: collectionId + fieldFilter EQUAL / compositeFilter AND over typed values; a value
//     compared across types (integerValue vs doubleValue) matches nothing, like the real index

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TYPES = ["nullValue", "booleanValue", "integerValue", "doubleValue", "timestampValue", "stringValue",
  "bytesValue", "referenceValue", "geoPointValue", "arrayValue", "mapValue"];

export function validateValue(v, where) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return `${where}: value is not an object`;
  const keys = Object.keys(v);
  if (keys.length !== 1 || !TYPES.includes(keys[0])) return `${where}: value must have exactly one type key (got ${keys.join(",")})`;
  const k = keys[0], x = v[k];
  switch (k) {
    case "integerValue":
      if (typeof x !== "string" || !/^-?\d+$/.test(x)) return `${where}: integerValue must be a decimal string (got ${typeof x} ${JSON.stringify(x)})`;
      return null;
    case "doubleValue": return typeof x === "number" ? null : `${where}: doubleValue must be a number`;
    case "stringValue": return typeof x === "string" ? null : `${where}: stringValue must be a string`;
    case "booleanValue": return typeof x === "boolean" ? null : `${where}: booleanValue must be a boolean`;
    case "nullValue": return x === null ? null : `${where}: nullValue must be null`;
    case "timestampValue": return typeof x === "string" && !Number.isNaN(Date.parse(x)) ? null : `${where}: bad timestampValue`;
    case "arrayValue": {
      if (!x || typeof x !== "object") return `${where}: arrayValue must be an object`;
      for (const [i, e] of (x.values || []).entries()) { const m = validateValue(e, `${where}[${i}]`); if (m) return m; }
      return null;
    }
    case "mapValue": {
      if (!x || typeof x !== "object") return `${where}: mapValue must be an object`;
      for (const [fk, fv] of Object.entries(x.fields || {})) { const m = validateValue(fv, `${where}.${fk}`); if (m) return m; }
      return null;
    }
    default: return null;
  }
}

const err = (status, code, message) => ({ status, body: { error: { code: status, status: code, message } } });
const tsNow = () => new Date().toISOString();
let tick = 0;

export function createStore() {
  return { docs: new Map(), writes: [], rejected: [] };
}
export function putDoc(store, coll, id, fields) {
  store.docs.set(`${coll}/${id}`, { fields, createTime: tsNow(), updateTime: tsNow() + "#" + (++tick) });
}
export function getDocFields(store, coll, id) {
  const d = store.docs.get(`${coll}/${id}`);
  return d ? d.fields : null;
}

// Decodes a typed value to plain JS (for tests and the query matcher).
export function decode(v) {
  if (!v) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  if ("mapValue" in v) { const o = {}; for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = decode(x); return o; }
  return undefined;
}

function docJson(base, coll, id, d) {
  return { name: `${base}/${coll}/${id}`, fields: d.fields, createTime: d.createTime, updateTime: d.updateTime };
}

// base: ".../documents" path as the server sees it (used to build names). urlPath is the request
// path with the "/documents/" prefix already stripped -> "coll/id". Returns {status, body}.
export function handleDoc(store, base, method, rel, query, bodyObj) {
  const segs = rel.split("/").filter(Boolean).map(decodeURIComponent);
  if (segs.length !== 2) return err(400, "INVALID_ARGUMENT", `unsupported document path ${rel}`);
  const [coll, id] = segs;
  if (id === "." || id === ".." || /^__.*__$/.test(id) || id.includes("/")) return err(400, "INVALID_ARGUMENT", "bad document id");
  const key = `${coll}/${id}`;
  const cur = store.docs.get(key);
  if (method === "GET") return cur ? { status: 200, body: docJson(base, coll, id, cur) } : err(404, "NOT_FOUND", "Document not found");
  if (method === "DELETE") { store.docs.delete(key); return { status: 200, body: {} }; }
  if (method !== "PATCH") return err(405, "UNIMPLEMENTED", method);

  const mask = query.getAll("updateMask.fieldPaths");
  if (!mask.length) return err(400, "INVALID_ARGUMENT", "unmasked write refused by the fixture: the house rule is masked PATCH only");
  for (const m of mask) if (!ID_RE.test(m)) return err(400, "INVALID_ARGUMENT", `invalid field path ${JSON.stringify(m)} (needs backticks)`);
  if (!bodyObj || typeof bodyObj !== "object" || (bodyObj.fields != null && typeof bodyObj.fields !== "object")) return err(400, "INVALID_ARGUMENT", "bad body");
  const fields = bodyObj.fields || {};
  for (const k of Object.keys(fields)) {
    if (!ID_RE.test(k)) return err(400, "INVALID_ARGUMENT", `invalid field name ${JSON.stringify(k)}`);
    if (!mask.includes(k)) return err(400, "INVALID_ARGUMENT", `field ${k} is in the body but not in updateMask`);
    const m = validateValue(fields[k], k);
    if (m) return err(400, "INVALID_ARGUMENT", m);
  }
  const ex = query.get("currentDocument.exists");
  const ut = query.get("currentDocument.updateTime");
  if (ex === "false" && cur) return err(409, "ALREADY_EXISTS", "Document already exists");
  if (ex === "true" && !cur) return err(404, "NOT_FOUND", "Document not found");
  if (ut != null && (!cur || cur.updateTime !== ut)) return err(400, "FAILED_PRECONDITION", "updateTime precondition failed");

  const next = { ...(cur ? cur.fields : {}) };
  for (const m of mask) { if (m in fields) next[m] = fields[m]; else delete next[m]; }
  if (JSON.stringify(next).length > 1048576) return err(400, "INVALID_ARGUMENT", "document too large");
  const doc = { fields: next, createTime: cur ? cur.createTime : tsNow(), updateTime: tsNow() + "#" + (++tick) };
  store.docs.set(key, doc);
  store.writes.push({ coll, id, mask: mask.slice(), exists: ex, updateTime: ut });
  return { status: 200, body: docJson(base, coll, id, doc) };
}

function matches(filter, fields) {
  if (!filter) return true;
  if (filter.compositeFilter) {
    if (filter.compositeFilter.op !== "AND") throw new Error("fixture: only AND composites");
    return filter.compositeFilter.filters.every((f) => matches(f, fields));
  }
  const ff = filter.fieldFilter;
  if (!ff || ff.op !== "EQUAL") throw new Error("fixture: only EQUAL field filters");
  const have = fields[ff.field.fieldPath];
  if (!have) return false;
  const [type] = Object.keys(ff.value);
  if (!(type in have)) return false; // integerValue vs doubleValue vs stringValue never match
  return JSON.stringify(have[type]) === JSON.stringify(ff.value[type]);
}

// Runs a structuredQuery against the in-memory docs of ONE collection id (the REST API's
// collectionId; our fixtures keep `coll` as the first path segment).
export function runQuery(store, base, structuredQuery) {
  const from = structuredQuery && structuredQuery.from && structuredQuery.from[0];
  if (!from || !from.collectionId) return err(400, "INVALID_ARGUMENT", "from.collectionId required");
  const out = [];
  for (const [key, d] of store.docs) {
    const [coll, id] = key.split("/");
    if (coll !== from.collectionId) continue;
    if (!matches(structuredQuery.where, d.fields)) continue;
    out.push({ document: docJson(base, coll, id, d), readTime: tsNow() });
  }
  return { status: 200, body: out.length ? out : [{ readTime: tsNow() }] };
}
