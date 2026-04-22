export type ThoughtType =
  | "thought"
  | "action"
  | "success"
  | "error"
  | "healing"
  | "payment"
  | "done";

export interface AgentThought {
  type: ThoughtType;
  message: string;
  metadata?: Record<string, unknown>;
  ts?: number;  // Unix timestamp from backend — used for elapsed time display
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  thoughts?: AgentThought[];
  timestamp: Date;
}
