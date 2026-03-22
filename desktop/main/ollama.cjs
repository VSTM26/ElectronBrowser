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
    throw new Error(`Failed to list models (${response.status}): ${await safeReadBody(response)}`);
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
    throw new Error(`Ollama chat failed (${response.status}): ${await safeReadBody(response)}`);
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

async function safeReadBody(response) {
  try {
    const text = await response.text();
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    return "Unable to read response body.";
  }
}

module.exports = {
  chat,
  listModels,
  normalizeBaseUrl,
  testConnection
};
