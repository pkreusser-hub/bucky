// Public goat feed for the Amen Farms sales website (amenfarms-site).
// Reads the family's goat records from Firestore SERVER-SIDE and returns ONLY goat fields —
// the private chores/bank/work-order data in the same collection never reaches the browser.
// The sales site fetches this cross-origin and renders the herd + for-sale goats live.

const PROJECT_ID = "amen-farms-app";
const FAMILY_KEY = "fam2jan2g";   // roomId("amenfarms") — the family's data area
const COLLECTION = "chores_" + FAMILY_KEY;
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const cors = {
  "Access-Control-Allow-Origin": "*",           // public, read-only goat data
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=120",       // light caching; app edits show within ~2 min
};

// Unwrap one Firestore typed value into a plain JS value.
function val(v) {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(val);
  return undefined;
}

// One Firestore goat doc → a sanitized public goat object (goat fields only).
function toGoat(fields) {
  const f = (k) => val(fields[k]);
  const cover = f("photo") || "";
  const gallery = (f("photos") || []).filter((x) => typeof x === "string" && x);
  return {
    name: f("name") || "",
    breed: f("breed") || "",
    sex: f("type") || "",                 // doe / buck / wether / doeling / buckling
    dob: f("dob") || "",
    sire: f("sire") || "",
    dam: f("dam") || "",
    registered: !!f("registered"),
    forSale: !!f("forSale"),
    price: f("price") || 0,
    saleNote: f("saleNote") || "",
    about: f("about") || "",              // the goat's "about me" bio
    photo: cover,                         // small data-URL cover thumbnail
    photos: gallery.length ? gallery : (cover ? [cover] : []),   // up to 6 gallery photos
  };
}

// The live herd has duplicate docs per goat (a known data-quality artifact). Merge by name so
// each goat appears once, preferring filled-in fields and any for-sale designation.
function mergeByName(goats) {
  const byName = new Map();
  for (const g of goats) {
    const key = g.name.trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) { byName.set(key, { ...g }); continue; }
    const m = byName.get(key);
    for (const fld of ["breed", "sex", "dob", "sire", "dam", "photo", "about"]) if (!m[fld] && g[fld]) m[fld] = g[fld];
    if ((g.photos || []).length > (m.photos || []).length) m.photos = g.photos;  // keep the richest gallery
    if (g.registered) m.registered = true;
    if (g.forSale) {
      m.forSale = true;
      if (g.price) m.price = g.price;
      if (g.saleNote) m.saleNote = g.saleNote;
    }
    if (!m.saleNote && g.saleNote) m.saleNote = g.saleNote;
  }
  return [...byName.values()];
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  try {
    const docs = [];
    let pageToken = "";
    do {
      const url = `${FIRESTORE}/${COLLECTION}?pageSize=300` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
      const r = await fetch(url);
      if (!r.ok) return new Response(JSON.stringify({ error: "Firestore read failed (" + r.status + ")" }), { status: 502, headers: cors });
      const j = await r.json();
      docs.push(...(j.documents || []));
      pageToken = j.nextPageToken || "";
    } while (pageToken);

    const goats = mergeByName(
      docs
        .map((d) => d.fields || {})
        .filter((f) => (f.frequency && f.frequency.stringValue) === "goathooves")
        .map(toGoat)
        .filter((g) => g.name)
    ).sort((a, b) => a.name.localeCompare(b.name));

    // Keep the feed light: only for-sale goats carry their full photo gallery (that's where the
    // click-through matters); herd goats expose just their cover thumbnail.
    for (const g of goats) {
      g.photos = g.photos.slice(0, 6);
      if (!g.forSale) g.photos = g.photo ? [g.photo] : [];
    }

    return new Response(JSON.stringify({ goats, count: goats.length }), { status: 200, headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }), { status: 500, headers: cors });
  }
};
