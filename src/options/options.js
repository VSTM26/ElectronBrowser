const elements = {
  form: document.getElementById("settings-form"),
  baseUrl: document.getElementById("base-url"),
  apiKey: document.getElementById("api-key"),
  modelSelect: document.getElementById("model-select"),
  modelCustom: document.getElementById("model-custom"),
  approvalMode: document.getElementById("approval-mode"),
  sensitiveWarnings: document.getElementById("sensitive-warnings"),
  allowedOrigins: document.getElementById("allowed-origins"),
  maxIterations: document.getElementById("max-iterations"),
  temperature: document.getElementById("temperature"),
  requestTimeout: document.getElementById("request-timeout"),
  retryAttempts: document.getElementById("retry-attempts"),
  keepAlive: document.getElementById("keep-alive"),
  status: document.getElementById("status"),
  testButton: document.getElementById("test-button"),
  openAgent: document.getElementById("open-agent"),
  refreshModels: document.getElementById("refresh-models"),
  auditLog: document.getElementById("audit-log"),
  refreshAudit: document.getElementById("refresh-audit"),
  clearAudit: document.getElementById("clear-audit"),
  exportAudit: document.getElementById("export-audit")
};

let currentSettings = null;

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Saving settings...");
  const response = await chrome.runtime.sendMessage({
    type: "saveSettings",
    settings: collectFormValues()
  });
  if (response?.ok) {
    setStatus("Settings saved.", "success");
  } else {
    setStatus(response?.error || "Unable to save settings.", "error");
  }
});

elements.testButton.addEventListener("click", async () => {
  setStatus("Testing connection...");
  const saveResponse = await chrome.runtime.sendMessage({
    type: "saveSettings",
    settings: collectFormValues()
  });
  if (!saveResponse?.ok) {
    setStatus(saveResponse?.error || "Unable to save settings before testing.", "error");
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: "testConnection" });
  if (response?.ok) {
    const modelNames = response.models.map((m) => typeof m === "string" ? m : m.name);
    const modelSummary = modelNames.length
      ? ` Models: ${modelNames.join(", ")}`
      : "";
    setStatus(`✓ Connection successful. Found ${response.modelCount} models.${modelSummary}`, "success");
  } else {
    let message = response?.error || "Connection test failed.";
    if (response?.diagnostics?.length) {
      message += "\n" + response.diagnostics.join("\n");
    }
    setStatus(message, "error");
  }
});

elements.openAgent.addEventListener("click", async () => {
  setStatus("Opening the browser agent side panel...");
  const response = await chrome.runtime.sendMessage({ type: "openSidePanel" });
  if (response?.ok) {
    setStatus("Side panel opened. Switch back to any website tab.", "success");
  } else {
    setStatus(response?.error || "Unable to open the side panel.", "error");
  }
});

elements.refreshModels.addEventListener("click", async () => {
  setStatus("Refreshing available models...");
  const saveResponse = await chrome.runtime.sendMessage({
    type: "saveSettings",
    settings: collectFormValues()
  });
  if (!saveResponse?.ok) {
    setStatus(saveResponse?.error || "Unable to save settings before refreshing models.", "error");
    return;
  }

  currentSettings = saveResponse.settings;
  await refreshModelList(currentSettings.model);
});

elements.modelSelect.addEventListener("change", () => {
  const value = elements.modelSelect.value;
  if (value === "__custom__") {
    elements.modelCustom.disabled = false;
    elements.modelCustom.focus();
    return;
  }

  elements.modelCustom.value = "";
  elements.modelCustom.disabled = true;
});

elements.refreshAudit.addEventListener("click", () => {
  void loadAuditLog();
});

elements.clearAudit.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "clearAuditLog" });
  if (response?.ok) {
    renderAuditLog([]);
    setStatus("Audit log cleared.", "success");
  }
});

elements.exportAudit.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "getAuditLog" });
  if (!response?.ok) {
    setStatus("Unable to load audit log.", "error");
    return;
  }

  const data = JSON.stringify(response.log, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ollama-audit-log-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Audit log exported.", "success");
});

initialize();

async function initialize() {
  const response = await chrome.runtime.sendMessage({ type: "getSettings" });
  if (!response?.ok) {
    setStatus("Unable to load settings.", "error");
    return;
  }

  const settings = response.settings;
  currentSettings = settings;
  elements.baseUrl.value = settings.baseUrl || "";
  elements.apiKey.value = settings.apiKey || "";
  elements.approvalMode.value = settings.approvalMode || "manual";
  elements.sensitiveWarnings.checked = settings.sensitiveActionWarnings !== false;
  elements.allowedOrigins.value = settings.allowedOrigins || "";
  elements.maxIterations.value = String(settings.maxIterations || 12);
  elements.temperature.value = String(settings.temperature ?? 0.2);
  elements.requestTimeout.value = String(settings.requestTimeoutMs || 120000);
  elements.retryAttempts.value = String(settings.retryAttempts ?? 2);
  elements.keepAlive.value = settings.keepAlive || "";
  await refreshModelList(settings.model);
  await loadAuditLog();
  setStatus("");
}

function collectFormValues() {
  return {
    baseUrl: elements.baseUrl.value,
    apiKey: elements.apiKey.value,
    model: getSelectedModel(),
    approvalMode: elements.approvalMode.value,
    sensitiveActionWarnings: elements.sensitiveWarnings.checked,
    allowedOrigins: elements.allowedOrigins.value,
    maxIterations: Number(elements.maxIterations.value),
    temperature: Number(elements.temperature.value),
    requestTimeoutMs: Number(elements.requestTimeout.value),
    retryAttempts: Number(elements.retryAttempts.value),
    keepAlive: elements.keepAlive.value
  };
}

function setStatus(message, type) {
  elements.status.textContent = message;
  elements.status.className = `status-message ${type || ""}`;
}

async function refreshModelList(selectedModel) {
  const response = await chrome.runtime.sendMessage({ type: "listModels" });
  const rawModels = response?.ok ? response.models : [];
  const models = rawModels.map((m) => typeof m === "string" ? m : m.name);
  populateModelSelect(models, selectedModel);

  if (response?.ok) {
    setStatus(models.length ? `Loaded ${models.length} installed models.` : "No downloaded models found on this endpoint.", models.length ? "success" : "");
  } else {
    setStatus(response?.error || "Unable to load models from the current Ollama endpoint.", "error");
  }
}

function populateModelSelect(models, selectedModel) {
  const normalizedModels = Array.from(new Set(models)).sort((left, right) => left.localeCompare(right));
  const options = normalizedModels.map((model) => ({
    value: model,
    label: model
  }));

  const hasSelectedModel = selectedModel && normalizedModels.includes(selectedModel);
  if (selectedModel && !hasSelectedModel) {
    options.unshift({
      value: selectedModel,
      label: `${selectedModel} (current)`
    });
  }

  options.push({
    value: "__custom__",
    label: "Custom model name"
  });

  elements.modelSelect.textContent = "";
  for (const optionConfig of options) {
    const option = document.createElement("option");
    option.value = optionConfig.value;
    option.textContent = optionConfig.label;
    elements.modelSelect.appendChild(option);
  }

  if (selectedModel && (hasSelectedModel || options.some((option) => option.value === selectedModel))) {
    elements.modelSelect.value = selectedModel;
    elements.modelCustom.value = "";
    elements.modelCustom.disabled = true;
  } else {
    elements.modelSelect.value = "__custom__";
    elements.modelCustom.value = selectedModel || "";
    elements.modelCustom.disabled = false;
  }
}

function getSelectedModel() {
  if (elements.modelSelect.value === "__custom__") {
    return elements.modelCustom.value.trim();
  }

  return elements.modelSelect.value.trim();
}

async function loadAuditLog() {
  const response = await chrome.runtime.sendMessage({ type: "getAuditLog" });
  if (response?.ok) {
    renderAuditLog(response.log);
  }
}

function renderAuditLog(log) {
  elements.auditLog.textContent = "";

  if (!log.length) {
    const empty = document.createElement("p");
    empty.className = "empty-text";
    empty.textContent = "No audit entries yet. Run a task to generate entries.";
    elements.auditLog.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const entry of log.slice().reverse().slice(0, 100)) {
    const div = document.createElement("div");
    div.className = `audit-entry ${entry.type || ""}`;

    const time = document.createElement("div");
    time.className = "audit-time";
    time.textContent = formatAuditTime(entry.timestamp);

    const text = document.createElement("div");
    text.className = "audit-text";
    text.textContent = formatAuditEntry(entry);

    div.append(time, text);
    fragment.appendChild(div);
  }

  elements.auditLog.appendChild(fragment);
}

function formatAuditEntry(entry) {
  switch (entry.type) {
    case "task_start":
      return `Task started: ${entry.task || ""}`;
    case "task_complete":
      return `Task completed: ${entry.summary || ""}`;
    case "task_timeout":
      return `Task timed out after ${entry.maxIterations || "?"} steps.`;
    case "tool_executed":
      return `${entry.ok ? "✓" : "✕"} ${entry.tool || ""}: ${entry.summary || ""}`;
    case "action_denied":
      return `Denied: ${entry.tool || ""}`;
    case "model_error":
      return `Model error: ${entry.error || ""}`;
    default:
      return entry.type || "Unknown event";
  }
}

function formatAuditTime(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return "";
  }
}
