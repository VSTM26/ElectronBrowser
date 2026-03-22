import { DEFAULT_SETTINGS } from "./constants.js";

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return normalizeSettings(settings);
}

export async function saveSettings(partialSettings) {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...partialSettings });
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function normalizeSettings(rawSettings = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(rawSettings || {}) };
  settings.baseUrl = String(settings.baseUrl || DEFAULT_SETTINGS.baseUrl).trim();
  settings.apiKey = String(settings.apiKey || "").trim();
  settings.model = String(settings.model || DEFAULT_SETTINGS.model).trim();
  settings.approvalMode = settings.approvalMode === "auto" ? "auto" : "manual";
  settings.allowedOrigins = String(settings.allowedOrigins || "").trim();
  settings.maxIterations = clampInteger(settings.maxIterations, 2, 30, DEFAULT_SETTINGS.maxIterations);
  settings.temperature = clampNumber(settings.temperature, 0, 2, DEFAULT_SETTINGS.temperature);
  settings.keepAlive = String(settings.keepAlive || DEFAULT_SETTINGS.keepAlive).trim();
  settings.requestTimeoutMs = clampInteger(settings.requestTimeoutMs, 5000, 600000, DEFAULT_SETTINGS.requestTimeoutMs);
  settings.retryAttempts = clampInteger(settings.retryAttempts, 0, 5, DEFAULT_SETTINGS.retryAttempts);
  settings.enableScreenshots = settings.enableScreenshots === true;
  settings.enableConsoleLogs = settings.enableConsoleLogs !== false;
  settings.sensitiveActionWarnings = settings.sensitiveActionWarnings !== false;
  return settings;
}

export function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/api")) {
    return trimmed;
  }

  return `${trimmed}/api`;
}

export function parseAllowedOrigins(rawValue) {
  return String(rawValue || "")
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function isOriginAllowed(url, settings) {
  const patterns = parseAllowedOrigins(settings.allowedOrigins);
  if (!patterns.length) {
    return true;
  }

  let origin;
  let hostname;
  try {
    const parsed = new URL(url);
    origin = parsed.origin;
    hostname = parsed.hostname;
  } catch {
    return false;
  }

  return patterns.some((pattern) => {
    if (pattern === origin || pattern === hostname) {
      return true;
    }

    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      return hostname.endsWith(suffix);
    }

    return false;
  });
}

export async function getAuditLog() {
  const { auditLog } = await chrome.storage.local.get("auditLog");
  return Array.isArray(auditLog) ? auditLog : [];
}

export async function appendAuditEntry(entry) {
  const log = await getAuditLog();
  log.push({
    ...entry,
    timestamp: new Date().toISOString()
  });
  const trimmed = log.slice(-1000);
  await chrome.storage.local.set({ auditLog: trimmed });
  return trimmed;
}

export async function clearAuditLog() {
  await chrome.storage.local.set({ auditLog: [] });
}

export async function getWorkflows() {
  const { workflows } = await chrome.storage.local.get("workflows");
  return Array.isArray(workflows) ? workflows : [];
}

export async function saveWorkflow(workflow) {
  const workflows = await getWorkflows();
  const existing = workflows.findIndex((w) => w.id === workflow.id);
  if (existing >= 0) {
    workflows[existing] = workflow;
  } else {
    workflows.push(workflow);
  }
  await chrome.storage.local.set({ workflows });
  return workflows;
}

export async function deleteWorkflow(workflowId) {
  const workflows = await getWorkflows();
  const filtered = workflows.filter((w) => w.id !== workflowId);
  await chrome.storage.local.set({ workflows: filtered });
  return filtered;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}
