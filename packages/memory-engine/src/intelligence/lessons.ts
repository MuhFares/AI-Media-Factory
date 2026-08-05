/**
 * Lessons engine (req #16): observations → validated, reusable lessons.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * observe → extract → validate (Evidence gate) → link (graph) → score →
 * promote (lessons store) → feed back into ranking. A lesson is "learned"
 * only when it changes what an agent will do next time.
 */

import type { MemoryRecord } from "../core/record";

export interface LessonCandidate {
  claim: string;
  scope: { topic?: string; brand?: string; agent?: string };
  evidence: MemoryRecord[];
}

export interface LessonsEngine {
  /** Form a candidate lesson from measured outcomes. */
  extract(observations: MemoryRecord[]): LessonCandidate | null;
  /** Validate against the Evidence gate; sufficient signal? */
  validate(candidate: LessonCandidate): boolean;
  /** Promote a validated lesson to the lessons store (scored + linked). */
  promote(candidate: LessonCandidate): Promise<MemoryRecord>;
}
