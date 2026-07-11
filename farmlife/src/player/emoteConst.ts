// ---------------------------------------------------------------------------
// emoteConst — the THREE-FREE half of emote.ts: the emote set + kinds. The 2D
// bundle (main, hud, render2d/remote2d) imports these from here so it never
// pulls the THREE sprite/texture builders in emote.ts. emote.ts `export *`s
// from here so the deprecated 3D emote-bubble path is unchanged.
// ---------------------------------------------------------------------------

export type EmoteKind = "wave" | "heart" | "laugh";
export const EMOTE_ORDER: EmoteKind[] = ["wave", "heart", "laugh"];
export const EMOTES: Record<EmoteKind, string> = {
  wave: "👋",
  heart: "❤️",
  laugh: "😄",
};
