export type CaptionLayoutVerdict = "PASS" | "CAPTION_LAYOUT_INVALID";

export interface CaptionLayoutPolicy {
  canvasWidth: number;
  canvasHeight: number;
  safeMarginLeft: number;
  safeMarginRight: number;
  safeMarginTop: number;
  safeMarginBottom: number;
  font: string;
  fontSize: number;
  lineHeight: number;
  maxLines: number;
}

export interface CaptionLayoutResult {
  verdict: CaptionLayoutVerdict;
  lines: string[];
  lineWidths: number[];
  safeArea: { left: number; right: number; top: number; bottom: number; width: number; height: number };
  boundingBox: { left: number; right: number; top: number; bottom: number; width: number; height: number };
  font: string;
  fontSize: number;
}

export const DEFAULT_VERTICAL_CAPTION_POLICY: CaptionLayoutPolicy = {
  canvasWidth: 480, canvasHeight: 832, safeMarginLeft: 36, safeMarginRight: 36,
  safeMarginTop: 24, safeMarginBottom: 112, font: "Arial", fontSize: 24, lineHeight: 30, maxLines: 2,
};

function glyphWidth(ch: string, fontSize: number): number {
  if (/\s/u.test(ch)) return fontSize * 0.28;
  if (/[ilI.,'!:;|]/u.test(ch)) return fontSize * 0.26;
  if (/[MW@#%&]/u.test(ch)) return fontSize * 0.9;
  return fontSize * 0.56;
}

function measure(text: string, fontSize: number): number {
  return [...text].reduce((sum, ch) => sum + glyphWidth(ch, fontSize), 0);
}

export function layoutCaption(text: string, policy: CaptionLayoutPolicy = DEFAULT_VERTICAL_CAPTION_POLICY): CaptionLayoutResult {
  const safeArea = { left: policy.safeMarginLeft, right: policy.canvasWidth - policy.safeMarginRight, top: policy.safeMarginTop, bottom: policy.canvasHeight - policy.safeMarginBottom, width: policy.canvasWidth - policy.safeMarginLeft - policy.safeMarginRight, height: policy.canvasHeight - policy.safeMarginTop - policy.safeMarginBottom };
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let invalid = words.length === 0;
  for (const word of words) {
    if (measure(word, policy.fontSize) > safeArea.width) invalid = true;
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(candidate, policy.fontSize) > safeArea.width) { lines.push(current); current = word; } else current = candidate;
  }
  if (current) lines.push(current);
  if (lines.length > policy.maxLines) invalid = true;
  const lineWidths = lines.map((line) => measure(line, policy.fontSize));
  const width = Math.max(0, ...lineWidths);
  const height = lines.length * policy.lineHeight;
  const left = Math.round((policy.canvasWidth - width) / 2);
  const top = safeArea.bottom - height;
  const boundingBox = { left, right: left + width, top, bottom: top + height, width, height };
  if (left < safeArea.left || boundingBox.right > safeArea.right || top < safeArea.top || boundingBox.bottom > safeArea.bottom) invalid = true;
  return { verdict: invalid ? "CAPTION_LAYOUT_INVALID" : "PASS", lines, lineWidths, safeArea, boundingBox, font: policy.font, fontSize: policy.fontSize };
}
