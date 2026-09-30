import { createHash } from "node:crypto";

export interface TTSChunk {
  index: number;
  count: number;
  text: string;
  characterCount: number;
  textFingerprint: string;
  chunkId: string;
}

/** Deterministic, provider-neutral narration chunking. */
export function chunkNarration(text: string, maxCharacters: number): TTSChunk[] {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) throw new Error("maxCharacters must be positive");
  const source = text.trim();
  if (source.length === 0) return [];
  const pieces: string[] = [];
  let current = "";
  const flush = () => { if (current.trim()) { pieces.push(current.trim()); current = ""; } };
  for (const sentence of source.split(/(?<=[.!?؟؛…])\s+/)) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (piece.length > maxCharacters) {
      flush();
      let rest = piece;
      while (rest.length > maxCharacters) {
        let cut = rest.lastIndexOf(" ", maxCharacters);
        if (cut <= 0) cut = maxCharacters;
        pieces.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
    } else if ((current + " " + piece).trim().length > maxCharacters) {
      flush(); current = piece;
    } else current = (current + " " + piece).trim();
  }
  flush();
  return pieces.map((chunk, index) => ({
    index, count: pieces.length, text: chunk, characterCount: chunk.length,
    textFingerprint: createHash("sha256").update(chunk).digest("hex"),
    chunkId: `tts-chunk-${String(index + 1).padStart(3, "0")}-${createHash("sha256").update(chunk).digest("hex").slice(0, 12)}`,
  }));
}

export function reconstructNarration(chunks: readonly TTSChunk[]): string {
  return chunks.map((chunk) => chunk.text).join(" ").trim();
}
