export const DEFAULT_SETTINGS = {
  baseUrl: "http://127.0.0.1:11434",
  apiKey: "",
  model: "qwen3:latest",
  approvalMode: "manual",
  allowedOrigins: "",
  maxIterations: 12,
  keepAlive: "10m",
  temperature: 0.2,
  requestTimeoutMs: 120000,
  retryAttempts: 2,
  enableScreenshots: false,
  enableConsoleLogs: true,
  sensitiveActionWarnings: true
};

export const MUTATING_TOOLS = new Set([
  "click_element",
  "close_current_tab",
  "go_back",
  "go_forward",
  "navigate_to",
  "open_new_tab",
  "open_or_search",
  "press_key",
  "reload_tab",
  "type_into_element"
]);

export const SENSITIVE_ACTIONS = new Set([
  "submit_form",
  "click_element"
]);

export const SENSITIVE_KEYWORDS = [
  "purchase",
  "buy",
  "checkout",
  "payment",
  "pay now",
  "confirm order",
  "place order",
  "delete",
  "remove",
  "unsubscribe",
  "deactivate",
  "close account",
  "cancel subscription",
  "submit",
  "send",
  "sign out",
  "log out",
  "transfer"
];

export const STATE_LIMITS = {
  logs: 500,
  visibleText: 8000,
  interactiveElements: 200,
  consoleLogs: 100
};

export const ERROR_CATEGORIES = {
  MODEL: "model_error",
  NETWORK: "network_error",
  DOM: "dom_error",
  PERMISSION: "permission_error",
  AUTH: "auth_error",
  CORS: "cors_error",
  TIMEOUT: "timeout_error",
  CANCELLED: "cancelled"
};

export const SYSTEM_PROMPT = [
  "You are an autonomous browser operator running inside a Chrome extension.",
  "Complete the user's task by using the available tools. Prefer inspecting the page before taking actions.",
  "A visible cursor appears on the page during movement, hover, typing, and click actions. Use it deliberately so the user can follow what will happen next.",
  "If the current tab is a restricted browser page such as chrome://newtab, first use open_or_search, navigate_to, or open_new_tab to move to a normal website.",
  "Never invent element ids or tab ids. Use tool outputs exactly as returned.",
  "Keep actions small and verifiable. If a form is sensitive, ask for approval through the existing tool flow instead of improvising.",
  "When the task is complete, respond with a concise summary and any important caveats.",
  "If the current page is restricted or unsuitable, explain why and suggest a next step.",
  "Always inspect the page after navigation or major actions to verify the result before proceeding.",
  "If an element is not found, re-inspect the page — the DOM may have changed.",
  "For multi-step workflows, verify each step succeeded before moving to the next.",
  "If you encounter a login page or authentication wall, report it clearly and ask the user for guidance.",
  "Prefer clear, descriptive summaries so the user understands exactly what happened."
].join(" ");
