// Client-safe part of the API keys (no node:crypto, no prisma): the scope list and its labels.
export const SCOPES = ["food-log:read", "food-log:write", "weight:read", "weight:write", "shopping:write"] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_LABELS: Record<Scope, string> = {
  "food-log:read": "Read my food log",
  "food-log:write": "Add / edit / delete my food log entries",
  "weight:read": "Read my weight",
  "weight:write": "Log my weight",
  "shopping:write": "Add items to the shopping list",
};
