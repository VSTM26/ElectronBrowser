import { normalizeBaseUrl } from "../shared/storage.js";
import { ERROR_CATEGORIES } from "../shared/constants.js";

export async function chatWithOllama({ settings, messages, tools }) {
  const endpoint = `${normalizeBaseUrl(settings.baseUrl)}/chat`;
  const body = JSON.stringify({
    model: settings.model,
    messages,
    tools,
    stream: false,
    keep_alive: settings.keepAlive,
    options: {
      temperature: settings.temperature
    }
  });

  let lastError = null;
  const maxAttempts = Math.max(1, (settings.retryAttempts || 0) + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: buildHeaders(settings),
        body
      }, settings.requestTimeoutMs || 120000);

      if (!response.ok) {
        const responseBody = await safeReadBody(response);
        const category = categorizeHttpError(response.status);
        const error = new Error(`Ollama chat failed (${response.status}): ${responseBody}`);
        error.category = category;
        error.statusCode = response.status;
        throw error;
      }

      return await response.json();
    } catch (error) {
      lastError = enrichError(error);

      if (attempt < maxAttempts && isRetryable(error)) {
        const delay = Math.min(2000 * attempt, 8000);
        await sleep(delay);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError;
}

export async function testOllamaConnection(settings) {
  try {
    const models = await listOllamaModels(settings);
    return {
      ok: true,
      modelCount: models.length,
      models: models.slice(0, 20)
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      category: error.category || ERROR_CATEGORIES.NETWORK,
      diagnostics: buildDiagnostics(error, settings)
    };
  }
}

export async function listOllamaModels(settings) {
  const endpoint = `${normalizeBaseUrl(settings.baseUrl)}/tags`;
  const response = await fetchWithTimeout(endpoint, {
    headers: buildHeaders(settings)
  }, 15000);

  if (!response.ok) {
    const body = await safeReadBody(response);
    const error = new Error(`Failed to list models (${response.status}): ${body}`);
    error.category = categorizeHttpError(response.status);
    throw error;
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

async function fetchWithTimeout(url, options, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s. The model may be loading or the endpoint is slow.`);
      timeoutError.category = ERROR_CATEGORIES.TIMEOUT;
      throw timeoutError;
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

function categorizeHttpError(status) {
  if (status === 403) {
    return ERROR_CATEGORIES.CORS;
  }
  if (status === 401) {
    return ERROR_CATEGORIES.AUTH;
  }
  if (status === 404) {
    return ERROR_CATEGORIES.MODEL;
  }
  if (status >= 500) {
    return ERROR_CATEGORIES.NETWORK;
  }
  return ERROR_CATEGORIES.NETWORK;
}

function isRetryable(error) {
  if (error.category === ERROR_CATEGORIES.AUTH || error.category === ERROR_CATEGORIES.CORS) {
    return false;
  }
  if (error.statusCode && error.statusCode < 500 && error.statusCode !== 429) {
    return false;
  }
  return true;
}

function enrichError(error) {
  if (error.category) {
    return error;
  }

  if (error.message?.includes("Failed to fetch") || error.message?.includes("NetworkError")) {
    error.category = ERROR_CATEGORIES.NETWORK;
    error.message = `Cannot reach Ollama endpoint. Is Ollama running? ${error.message}`;
  } else if (error.name === "AbortError") {
    error.category = ERROR_CATEGORIES.TIMEOUT;
  } else {
    error.category = ERROR_CATEGORIES.NETWORK;
  }

  return error;
}

function buildDiagnostics(error, settings) {
  const hints = [];

  if (error.category === ERROR_CATEGORIES.CORS) {
    hints.push("Ollama is blocking requests from this Chrome extension (HTTP 403).");
    hints.push("FIX: Run the setup script from the project folder: ./setup.sh");
    hints.push("OR manually restart Ollama with: OLLAMA_ORIGINS=\"*\" ollama serve");
    hints.push("This tells Ollama to accept requests from Chrome extensions.");
    return hints;
  }

  if (error.category === ERROR_CATEGORIES.NETWORK) {
    hints.push(`Tried endpoint: ${settings.baseUrl}`);
    hints.push("Check that Ollama is running: run 'ollama serve' in a terminal.");
    hints.push("If using a remote endpoint, verify the URL and network connectivity.");
  }

  if (error.category === ERROR_CATEGORIES.AUTH) {
    hints.push("Authentication failed. Check your API key in settings.");
    hints.push("If using ollama.com, make sure your API key is valid.");
  }

  if (error.category === ERROR_CATEGORIES.MODEL) {
    hints.push(`Model "${settings.model}" was not found.`);
    hints.push("Pull the model first: run 'ollama pull " + settings.model + "' in a terminal.");
  }

  if (error.category === ERROR_CATEGORIES.TIMEOUT) {
    hints.push("The request timed out. This can happen when a model is loading for the first time.");
    hints.push("Try increasing the timeout in advanced settings, or wait for the model to load.");
  }

  return hints;
}

async function safeReadBody(response) {
  try {
    const text = await response.text();
    return text.length > 500 ? text.slice(0, 500) + "..." : text;
  } catch {
    return "Unable to read response body.";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
