const DEFAULT_TIMEOUT_MS = 120000;

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "http://127.0.0.1:11434").trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

async function listModels(settings) {
  const endpoint = `${normalizeBaseUrl(settings.baseUrl)}/tags`;
  const response = await fetchWithTimeout(endpoint, {
    headers: buildHeaders(settings)
  }, 15000);

  if (!response.ok) {
    const body = await safeReadBody(response);
    throw new Error(buildOllamaHttpErrorMessage("list models", response.status, body, settings));
  }

  const payload = await response.json();
  return Array.isArray(payload.models)
    ? payload.models.map((model) => ({
      name: model.name,
      size: model.size || 0,
      modified: model.modified_at || "",
      details: model.details || {}
    }))
    : [];
}

async function chat(settings, messages, tools) {
  const endpoint = `${normalizeBaseUrl(settings.baseUrl)}/chat`;
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: buildHeaders(settings),
    body: JSON.stringify({
      model: settings.model,
      messages,
      tools,
      stream: false,
      keep_alive: settings.keepAlive || "10m",
      options: {
        temperature: Number.isFinite(settings.temperature) ? settings.temperature : 0.2
      }
    })
  }, settings.requestTimeoutMs || DEFAULT_TIMEOUT_MS);

  if (!response.ok) {
    const body = await safeReadBody(response);
    throw new Error(buildOllamaHttpErrorMessage("chat", response.status, body, settings));
  }

  return response.json();
}

async function testConnection(settings) {
  const models = await listModels(settings);
  return {
    ok: true,
    modelCount: models.length,
    models
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildHeaders(settings) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }

  return headers;
}

function buildOllamaHttpErrorMessage(action, status, body, settings) {
  const serverMessage = extractServerMessage(body);
  const localHint = isLikelyLocalBaseUrl(settings?.baseUrl);

  if (status === 401) {
    return localHint
      ? `Ollama ${action} failed: authentication was rejected. Local Ollama usually does not need an API key, so clear the API key field and make sure the Base URL is http://127.0.0.1:11434.`
      : `Ollama ${action} failed: the configured server rejected your credentials. Check the Base URL and API key for that endpoint.`;
  }

  if (status === 403 && /premium model access|subscription/i.test(serverMessage)) {
    return localHint
      ? `Ollama ${action} failed: this request was treated as premium-gated. If you meant to use local Ollama, make sure the Base URL is http://127.0.0.1:11434, clear the API key, and run ollama serve locally. Server said: ${truncateText(serverMessage, 220)}`
      : `Ollama ${action} failed: the configured server requires a paid subscription or premium access. For local ElectronBrowser use, switch the Base URL to http://127.0.0.1:11434 and clear the API key unless you intentionally want a hosted endpoint. Server said: ${truncateText(serverMessage, 220)}`;
  }

  if (status === 403) {
    return localHint
      ? `Ollama ${action} failed: access was forbidden by the configured endpoint. Double-check that the app is pointed at your local Ollama server on http://127.0.0.1:11434.`
      : `Ollama ${action} failed: the configured server denied access. Check whether this Base URL points to a hosted Ollama account, team gateway, or another restricted endpoint.`;
  }

  return `Ollama ${action} failed (${status}): ${serverMessage}`;
}

function extractServerMessage(body) {
  const text = String(body || "").trim();
  if (!text) {
    return "No server details were returned.";
  }

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // Fall back to the raw response text.
  }

  return truncateText(text, 320);
}

function isLikelyLocalBaseUrl(baseUrl) {
  try {
    const parsed = new URL(String(baseUrl || "http://127.0.0.1:11434"));
    return ["127.0.0.1", "localhost", "0.0.0.0", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function safeReadBody(response) {
  try {
    const text = await response.text();
    return truncateText(text, 500);
  } catch {
    return "Unable to read response body.";
  }
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

module.exports = {
  chat,
  listModels,
  normalizeBaseUrl,
  testConnection
};
