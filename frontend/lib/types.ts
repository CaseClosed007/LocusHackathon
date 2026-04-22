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

export interface BrandContext {
  company_name: string;
  tagline: string;
  mission: string;
  tone: string;
  target_audience: string;
  ui_style: string;
  colors: string[];
  color_roles: Record<string, string>;
  fonts: string[];
  keywords: string[];
  design_rules: string[];
  raw_excerpt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  thoughts?: AgentThought[];
  timestamp: Date;
}
