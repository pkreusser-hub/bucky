// ---------------------------------------------------------------------------
// Firebase bootstrap for Farm Life P2 (persistent shared world). House
// convention: config values are DUPLICATED inline per page/app (no shared JS
// module across pages in this repo — see index.html's firebaseConfig and
// farmkart.html's fkFirebaseConfig) rather than imported from elsewhere.
// Within farmlife itself this IS the one shared module every P2 store talks
// to, per the project's own "typed module" carve-out (see farmlife-plan.md).
//
// familyKey is the SAME roomId(FAMILY_PASSWORD) derivation as index.html /
// farmkart.html so all three apps land in the same family's data area
// (verified to produce "fam2jan2g" for the real family password).
// ---------------------------------------------------------------------------
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU",
  authDomain: "amen-farms-app.firebaseapp.com",
  projectId: "amen-farms-app",
  storageBucket: "amen-farms-app.firebasestorage.app",
  messagingSenderId: "321230755979",
  appId: "1:321230755979:web:d362c56aaf7e50b4ab5c8e",
};

const FAMILY_PASSWORD = "amenfarms";

/** Identical string-hash to index.html's roomId() — MUST match byte-for-byte
 * so all BUCKY apps resolve to the same family data area. */
export function roomId(pw: string): string {
  let h = 0;
  for (const ch of pw.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return "fam" + h.toString(36);
}

/** ?fam=<suffix> URL override — dev/test hook so automated verification can
 * target a scratch family collection instead of production (herd-dup lesson:
 * never let a headless test touch the real family's data). */
export function resolveFamilyKey(): string {
  try {
    const override = new URLSearchParams(location.search).get("fam");
    if (override) return override;
  } catch (_) {
    /* no location (non-browser test context) */
  }
  return roomId(FAMILY_PASSWORD);
}

/** Identity = localStorage choreUser (house convention), fallback "Farmer". */
export function currentPlayerName(): string {
  try {
    const n = localStorage.getItem("choreUser");
    if (n && n.trim()) return n.trim();
  } catch (_) {
    /* ignore */
  }
  return "Farmer";
}

let appPromise: Promise<{ app: FirebaseApp; db: Firestore } | null> | null = null;

/** Lazy, memoized Firestore init. Never throws — returns null on any failure
 * (network blocked, SDK error, etc.) so callers can gracefully fall back to
 * LocalFarmStore/LocalWorldStore. */
export function initFirestore(): Promise<{ app: FirebaseApp; db: Firestore; familyKey: string } | null> {
  if (!appPromise) {
    appPromise = (async () => {
      try {
        const app = initializeApp(firebaseConfig, "farmlife");
        const db = getFirestore(app);
        return { app, db };
      } catch (err) {
        console.warn("Farm Life: Firestore init failed — playing offline.", err);
        return null;
      }
    })();
  }
  return appPromise.then((r) => (r ? { ...r, familyKey: resolveFamilyKey() } : null));
}

export function farmlifeCollectionName(familyKey: string): string {
  return `farmlife_${familyKey}`;
}
