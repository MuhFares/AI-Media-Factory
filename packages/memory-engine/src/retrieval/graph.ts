/**
 * Knowledge graph relationships (req #12).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Nodes (brand, asset, topic, decision, lesson, agent, experiment, metric,
 * platform) and edges connect memory so retrieval can reason, not just match.
 */

import type { MemoryId } from "../core/common.js";

export type NodeKind =
  | "brand" | "asset" | "topic" | "decision" | "lesson"
  | "agent" | "experiment" | "metric" | "platform";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  memory_id: MemoryId | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: string; // e.g. produces, covers, derived_from, applies_to, governed_by
}

export interface KnowledgeGraph {
  addNode(node: GraphNode): Promise<void>;
  addEdge(edge: GraphEdge): Promise<void>;
  /** Traverse related nodes up to a depth (graph proximity for ranking). */
  related(nodeId: string, relations: string[], depth: number): Promise<GraphNode[]>;
}
