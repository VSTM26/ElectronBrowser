import { createPageCommandScript } from "./page-agent.js";

const runtimeParams = new URLSearchParams(window.location.search);
const bootMode = runtimeParams.get("bootMode") || "normal";
const START_PAGE_URL = new URL("./new-tab.html", window.location.href).toString();
const START_PAGE_DISPLAY_URL = "electron://new-tab";

const DEFAULT_SETTINGS = {
  baseUrl: "http://127.0.0.1:11434",
  apiKey: "",
  model: "qwen3:latest",
  temperature: 0.2,
  keepAlive: "10m",
  maxIterations: 10,
  requestTimeoutMs: 120000,
  approvalMode: "auto"
};

const MUTATING_TOOLS = new Set([
  "click_element",
  "close_current_tab",
  "go_back",
  "go_forward",
  "navigate_to",
  "open_new_tab",
  "open_or_search",
  "reload_tab",
  "type_into_element"
]);

const TOOL_DEFINITIONS = [
  defineTool("get_active_tab", "Return information about the active browser tab including title, URL, and tab id."),
  defineTool("list_tabs", "List the tabs currently open in the browser shell."),
  defineTool("switch_to_tab", "Activate a tab by id or fuzzy title match.", {
    tabId: { type: "string", description: "Tab id to activate." },
    query: { type: "string", description: "Partial title or URL to match." }
  }),
  defineTool("open_new_tab", "Open a new browser tab, optionally with a URL.", {
    url: { type: "string", description: "Optional destination URL." },
    active: { type: "boolean", description: "Whether the new tab becomes active.", default: true }
  }),
  defineTool("open_or_search", "Open a destination in the current tab. If the input is not a URL, run a Google search.", {
    query: { type: "string", description: "URL, hostname, or search query." }
  }, ["query"]),
  defineTool("navigate_to", "Navigate the current tab to an absolute URL.", {
    url: { type: "string", description: "Absolute URL starting with http or https." }
  }, ["url"]),
  defineTool("reload_tab", "Reload the current tab."),
  defineTool("go_back", "Go back in the current tab."),
  defineTool("go_forward", "Go forward in the current tab."),
  defineTool("close_current_tab", "Close the current tab."),
  defineTool("inspect_page", "Capture the current page state including a stable list of interactive elements. Use this before acting.", {
    includeText: { type: "boolean", description: "Include a visible text excerpt.", default: true },
    includeMetadata: { type: "boolean", description: "Include headings and links.", default: true }
  }),
  defineTool("click_element", "Click an interactive element on the current page by element id.", {
    elementId: { type: "string", description: "Stable element id from inspect_page." }
  }, ["elementId"]),
  defineTool("type_into_element", "Type text into an input, textarea, or contenteditable element.", {
    elementId: { type: "string", description: "Stable element id from inspect_page." },
    text: { type: "string", description: "Text to enter." },
    clearFirst: { type: "boolean", description: "Clear existing text first.", default: true },
    submit: { type: "boolean", description: "Press Enter after typing.", default: false }
  }, ["elementId", "text"]),
  defineTool("hover_element", "Hover over an element to reveal menus or tooltips.", {
    elementId: { type: "string", description: "Stable element id from inspect_page." }
  }, ["elementId"]),
  defineTool("move_mouse_to_element", "Move the visible cursor to a specific element before acting.", {
    elementId: { type: "string", description: "Stable element id from inspect_page." }
  }, ["elementId"]),
  defineTool("move_mouse_to_coordinates", "Move the visible cursor to viewport coordinates.", {
    x: { type: "integer", description: "Viewport x coordinate." },
    y: { type: "integer", description: "Viewport y coordinate." },
    label: { type: "string", description: "Optional short label near the cursor." }
  }, ["x", "y"]),
  defineTool("scroll_page", "Scroll the current page up or down by a fraction of the viewport height.", {
    direction: { type: "string", enum: ["up", "down"], default: "down" },
    amount: { type: "number", description: "Viewport multiple between 0.1 and 2.0.", default: 0.8 }
  }),
  defineTool("read_element_text", "Read the full text of a specific element.", {
    elementId: { type: "string", description: "Stable element id from inspect_page." }
  }, ["elementId"]),
  defineTool("wait", "Wait for a number of milliseconds so the page can update.", {
    milliseconds: { type: "integer", description: "Delay between 100 and 10000 milliseconds.", default: 1000 }
  })
];

const SYSTEM_PROMPT = [
  "You are an autonomous browser operator inside a local desktop browser shell.",
  "The user may ask for browser actions, summaries, explanations, or help understanding what is on the current page.",
  "Complete the user's request by using the available tools. Inspect the page before taking actions, and inspect before answering questions about what is visible.",
  "A visible cursor appears during movement, hover, typing, and click actions. Use it deliberately so the user can follow what will happen next.",
  "Never invent element ids or tab ids. Use tool outputs exactly as returned.",
  "Keep actions small and verifiable. Re-inspect after navigation or major actions.",
  "Respond conversationally and clearly. When the request is complete, answer like a helpful assistant and include any important caveats."
].join(" ");

const elements = {
  windowShell: document.getElementById("window-shell"),
  appVersion: document.getElementById("app-version"),
  tabs: document.getElementById("tabs"),
  newTabButton: document.getElementById("new-tab-button"),
  toggleAgentButton: document.getElementById("toggle-agent-button"),
  introOverlay: document.getElementById("intro-overlay"),
  addressForm: document.getElementById("address-form"),
  addressInput: document.getElementById("address-input"),
  backButton: document.getElementById("back-button"),
  forwardButton: document.getElementById("forward-button"),
  reloadButton: document.getElementById("reload-button"),
  homeButton: document.getElementById("home-button"),
  browserStack: document.getElementById("browser-stack"),
  activePageLabel: document.getElementById("active-page-label"),
  agentPane: document.getElementById("agent-pane"),
  agentScrollUpButton: document.getElementById("agent-scroll-up-button"),
  agentScrollDownButton: document.getElementById("agent-scroll-down-button"),
  statusPill: document.getElementById("status-pill"),
  stepIndicator: document.getElementById("step-indicator"),
  statusCopy: document.getElementById("status-copy"),
  taskForm: document.getElementById("task-form"),
  conversation: document.getElementById("conversation"),
  clearConversationButton: document.getElementById("clear-conversation-button"),
  taskInput: document.getElementById("task-input"),
  runTaskButton: document.getElementById("run-task-button"),
  stopTaskButton: document.getElementById("stop-task-button"),
  baseUrlInput: document.getElementById("base-url-input"),
  apiKeyInput: document.getElementById("api-key-input"),
  modelSelect: document.getElementById("model-select"),
  temperatureInput: document.getElementById("temperature-input"),
  iterationsInput: document.getElementById("iterations-input"),
  saveSettingsButton: document.getElementById("save-settings-button"),
  refreshModelsButton: document.getElementById("refresh-models-button"),
  testConnectionButton: document.getElementById("test-connection-button"),
  settingsFeedback: document.getElementById("settings-feedback"),
  clearLogsButton: document.getElementById("clear-logs-button"),
  logs: document.getElementById("logs")
};

const state = {
  settings: loadSettings(),
  preferences: loadPreferences(),
  tabs: [],
  activeTabId: null,
  conversation: loadConversation(),
  running: false,
  abortRequested: false,
  currentTask: "",
  currentStep: null,
  lastResult: "Waiting for a task.",
  logs: []
};

window.__LOCAL_COMET_READY__ = false;
window.addEventListener("error", (event) => {
  showBootError(event.error?.message || event.message || "Unknown renderer error");
});
window.addEventListener("unhandledrejection", (event) => {
  showBootError(event.reason?.message || String(event.reason || "Unknown async renderer error"));
});

void boot();

async function boot() {
  try {
    if (!window.desktopBridge) {
      throw new Error("desktopBridge is unavailable. The preload script did not initialize.");
    }

    bindEvents();
    hydrateSettingsForm();
    applyLayoutState();
    renderState();
    startIntroAnimation();
    const appInfo = await window.desktopBridge.getAppInfo();
    elements.appVersion.textContent = `${appInfo.name} v${appInfo.version}`;
    document.body.dataset.platform = appInfo.platform || "unknown";
    elements.windowShell.classList.toggle("platform-darwin", appInfo.platform === "darwin");

    await refreshModels({ silent: true });
    if (bootMode === "safe") {
      createTab(START_PAGE_URL);
      setFeedback("Recovered in safe mode after a renderer crash. Session restore was skipped for this launch.", "error");
      pushLog("warn", "Safe mode recovery active. Start from a fresh tab and reopen pages manually.");
    } else {
      restoreSession();
    }

    window.__LOCAL_COMET_READY__ = true;
    document.body.dataset.ready = "true";
  } catch (error) {
    console.error("Renderer boot failed", error);
    elements.appVersion.textContent = "Desktop shell";
    showBootError(error.message);
  }
}

function bindEvents() {
  elements.newTabButton.addEventListener("click", () => createTab(START_PAGE_URL));
  elements.toggleAgentButton.addEventListener("click", () => {
    state.preferences.agentPaneOpen = !state.preferences.agentPaneOpen;
    persistPreferences();
    applyLayoutState();
  });
  elements.agentScrollUpButton.addEventListener("click", () => {
    scrollAgentPane(-1);
  });
  elements.agentScrollDownButton.addEventListener("click", () => {
    scrollAgentPane(1);
  });
  elements.agentPane.addEventListener("scroll", () => {
    updateAgentScrollButtons();
  });
  window.addEventListener("resize", () => {
    window.requestAnimationFrame(updateAgentScrollButtons);
  });
  elements.addressForm.addEventListener("submit", (event) => {
    event.preventDefault();
    navigateActiveTab(elements.addressInput.value);
  });
  elements.backButton.addEventListener("click", () => goBack());
  elements.forwardButton.addEventListener("click", () => goForward());
  elements.reloadButton.addEventListener("click", () => reloadActiveTab());
  elements.homeButton.addEventListener("click", () => navigateActiveTab(START_PAGE_URL));
  elements.taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAgentTask(elements.taskInput.value);
  });
  elements.taskInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void runAgentTask(elements.taskInput.value);
    }
  });
  elements.stopTaskButton.addEventListener("click", () => {
    state.abortRequested = true;
    pushLog("warn", "Stop requested. The task will halt after the current model call or tool action.");
    renderState();
  });
  elements.clearConversationButton.addEventListener("click", () => {
    state.conversation = [];
    persistConversation();
    state.lastResult = "Waiting for a task.";
    renderState();
  });
  elements.saveSettingsButton.addEventListener("click", () => {
    state.settings = readSettingsForm();
    persistSettings();
    setFeedback("Settings saved locally for this browser.", "success");
  });
  elements.refreshModelsButton.addEventListener("click", () => {
    void refreshModels({ silent: false });
  });
  elements.testConnectionButton.addEventListener("click", () => {
    void testConnection();
  });
  elements.clearLogsButton.addEventListener("click", () => {
    state.logs = [];
    renderLogs();
  });

  document.addEventListener("keydown", (event) => {
    const modifierPressed = event.metaKey || event.ctrlKey;
    if (!modifierPressed) {
      return;
    }

    if (event.key.toLowerCase() === "l") {
      event.preventDefault();
      elements.addressInput.focus();
      elements.addressInput.select();
    } else if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      createTab(START_PAGE_URL);
    } else if (event.key.toLowerCase() === "w") {
      event.preventDefault();
      if (state.tabs.length > 1) {
        closeCurrentTab();
      }
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      void reloadActiveTab();
    }
  });
}

function createTab(initialUrl, options = {}) {
  const tabId = crypto.randomUUID();
  const destination = normalizeDestination(initialUrl || START_PAGE_URL);
  const webview = document.createElement("webview");
  webview.className = "browser-view";
  webview.dataset.tabId = tabId;
  webview.partition = "persist:local-comet-browser";
  webview.src = options.deferLoad === true ? "about:blank" : destination;
  webview.setAttribute("allowpopups", "true");
  elements.browserStack.append(webview);

  const tab = {
    id: tabId,
    title: options.title || "New tab",
    url: destination,
    pendingUrl: options.deferLoad === true ? destination : "",
    domReady: false,
    loading: options.deferLoad !== true,
    webview
  };

  attachWebviewEvents(tab);
  state.tabs.push(tab);
  if (options.select === false) {
    renderTabs();
    updateBrowserContext();
  } else {
    selectTab(tabId);
  }
  persistSession();
  return tab;
}

function attachWebviewEvents(tab) {
  const { webview } = tab;

  webview.addEventListener("dom-ready", () => {
    tab.domReady = true;
    updateBrowserContext();
    renderTabs();
  });

  webview.addEventListener("page-title-updated", (event) => {
    tab.title = event.title || tab.title;
    persistSession();
    renderTabs();
  });

  webview.addEventListener("did-navigate", (event) => {
    tab.url = event.url;
    syncAddressBar();
    updateBrowserContext();
    persistSession();
    renderTabs();
  });

  webview.addEventListener("did-navigate-in-page", (event) => {
    tab.url = event.url;
    syncAddressBar();
    updateBrowserContext();
    persistSession();
    renderTabs();
  });

  webview.addEventListener("did-start-loading", () => {
    tab.domReady = false;
    tab.loading = true;
    updateBrowserContext();
    renderTabs();
  });

  webview.addEventListener("did-stop-loading", () => {
    tab.loading = false;
    tab.url = webview.getURL() || tab.url;
    tab.title = webview.getTitle() || tab.title;
    syncAddressBar();
    updateBrowserContext();
    persistSession();
    renderTabs();
  });

  webview.addEventListener("did-fail-load", (event) => {
    if (event.errorCode === -3) {
      return;
    }
    tab.domReady = false;
    tab.loading = false;
    pushLog("error", `Failed to load ${event.validatedURL || tab.url}: ${event.errorDescription}`);
    updateBrowserContext();
  });

  webview.addEventListener("new-window", (event) => {
    if (event.url) {
      createTab(event.url);
    }
  });
}

function selectTab(tabId) {
  state.activeTabId = tabId;
  for (const tab of state.tabs) {
    tab.webview.classList.toggle("active", tab.id === tabId);
  }
  syncAddressBar();
  updateBrowserContext();
  persistSession();
  renderTabs();
  void ensureTabIsLoaded(getActiveTab());
}

function closeTab(tabId) {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return;
  }

  const [tab] = state.tabs.splice(index, 1);
  tab.webview.remove();

  if (!state.tabs.length) {
    createTab(START_PAGE_URL);
    return;
  }

  if (state.activeTabId === tabId) {
    const next = state.tabs[Math.max(0, index - 1)] || state.tabs[0];
    selectTab(next.id);
  } else {
    renderTabs();
  }

  persistSession();
}

function renderTabs() {
  elements.tabs.textContent = "";
  for (const tab of state.tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab-button ${tab.id === state.activeTabId ? "active" : ""}`;

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.loading ? `Loading ${tab.title || "tab"}...` : tab.title || tab.url || "New tab";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tab.id);
    });

    button.append(title, close);
    button.addEventListener("click", () => selectTab(tab.id));
    elements.tabs.append(button);
  }
}

function hydrateSettingsForm() {
  elements.baseUrlInput.value = state.settings.baseUrl;
  elements.apiKeyInput.value = state.settings.apiKey;
  elements.temperatureInput.value = String(state.settings.temperature);
  elements.iterationsInput.value = String(state.settings.maxIterations);
  populateModelOptions([{ name: state.settings.model }], state.settings.model);
}

function readSettingsForm() {
  return {
    ...state.settings,
    baseUrl: elements.baseUrlInput.value.trim() || DEFAULT_SETTINGS.baseUrl,
    apiKey: elements.apiKeyInput.value.trim(),
    model: elements.modelSelect.value || state.settings.model || DEFAULT_SETTINGS.model,
    temperature: clampNumber(elements.temperatureInput.value, 0, 2, DEFAULT_SETTINGS.temperature),
    maxIterations: clampInteger(elements.iterationsInput.value, 2, 30, DEFAULT_SETTINGS.maxIterations),
    requestTimeoutMs: DEFAULT_SETTINGS.requestTimeoutMs,
    keepAlive: DEFAULT_SETTINGS.keepAlive
  };
}

function loadSettings() {
  try {
    const raw = localStorage.getItem("desktopSettings");
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      ...DEFAULT_SETTINGS,
      ...parsed
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function loadPreferences() {
  try {
    const raw = localStorage.getItem("desktopPreferences");
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      agentPaneOpen: parsed.agentPaneOpen !== false
    };
  } catch {
    return {
      agentPaneOpen: true
    };
  }
}

function loadConversation() {
  try {
    const raw = localStorage.getItem("desktopConversation");
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry) => entry && (entry.role === "user" || entry.role === "assistant") && typeof entry.content === "string")
      .map((entry) => ({
        role: entry.role,
        content: entry.content,
        timestamp: entry.timestamp || new Date().toISOString()
      }))
      .slice(-24);
  } catch {
    return [];
  }
}

function persistSettings() {
  localStorage.setItem("desktopSettings", JSON.stringify(state.settings));
}

function persistConversation() {
  localStorage.setItem("desktopConversation", JSON.stringify(state.conversation));
}

function restoreSession() {
  const snapshot = loadSessionSnapshot();
  if (!snapshot?.tabs?.length) {
    createTab(START_PAGE_URL);
    return;
  }

  const activeIndex = clampInteger(snapshot.activeIndex, 0, snapshot.tabs.length - 1, 0);
  const restoredTabs = snapshot.tabs
    .map((entry, index) => createTab(entry.url || START_PAGE_URL, {
      title: entry.title || "New tab",
      select: index === activeIndex,
      deferLoad: index !== activeIndex
    }))
    .filter(Boolean);

  if (!restoredTabs[activeIndex] && restoredTabs[0]) {
    selectTab(restoredTabs[0].id);
  }
}

function loadSessionSnapshot() {
  try {
    const raw = localStorage.getItem("desktopSession");
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || !Array.isArray(parsed.tabs)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistSession() {
  if (!state.tabs.length) {
    localStorage.removeItem("desktopSession");
    return;
  }

  const activeIndex = Math.max(0, state.tabs.findIndex((tab) => tab.id === state.activeTabId));
  const snapshot = {
    activeIndex,
    tabs: state.tabs.map((tab) => ({
      title: tab.title || "",
      url: tab.url || START_PAGE_URL
    }))
  };
  localStorage.setItem("desktopSession", JSON.stringify(snapshot));
}

async function ensureTabIsLoaded(tab) {
  if (!tab?.pendingUrl) {
    return;
  }

  const destination = tab.pendingUrl;
  tab.pendingUrl = "";
  tab.loading = true;
  updateBrowserContext();
  renderTabs();

  try {
    await waitForWebviewDomReady(tab.webview);
    await tab.webview.loadURL(destination);
  } catch (error) {
    pushLog("error", `Unable to restore ${destination}: ${error.message}`);
    tab.loading = false;
    tab.pendingUrl = destination;
    updateBrowserContext();
    renderTabs();
  }
}

function persistPreferences() {
  localStorage.setItem("desktopPreferences", JSON.stringify(state.preferences));
}

function applyLayoutState() {
  elements.windowShell.classList.toggle("agent-collapsed", state.preferences.agentPaneOpen === false);
  elements.toggleAgentButton.textContent = state.preferences.agentPaneOpen ? "Hide assistant" : "Show assistant";
  elements.toggleAgentButton.setAttribute("aria-pressed", state.preferences.agentPaneOpen ? "true" : "false");
  window.requestAnimationFrame(updateAgentScrollButtons);
}

function getAgentScrollStep() {
  return Math.max(240, Math.round(elements.agentPane.clientHeight * 0.72));
}

function scrollAgentPane(direction) {
  const delta = direction * getAgentScrollStep();
  elements.agentPane.scrollBy({ top: delta, behavior: "auto" });
  window.requestAnimationFrame(updateAgentScrollButtons);
}

function updateAgentScrollButtons() {
  const pane = elements.agentPane;
  const maxScroll = Math.max(0, pane.scrollHeight - pane.clientHeight);
  const atTop = pane.scrollTop <= 1;
  const atBottom = maxScroll <= 1 || pane.scrollTop >= maxScroll - 1;
  const paneOpen = state.preferences.agentPaneOpen !== false;

  elements.agentScrollUpButton.disabled = !paneOpen || atTop;
  elements.agentScrollDownButton.disabled = !paneOpen || atBottom;
}

async function refreshModels({ silent }) {
  state.settings = readSettingsForm();
  persistSettings();

  try {
    const models = await window.desktopBridge.listModels(state.settings);
    populateModelOptions(models, state.settings.model);
    if (!silent) {
      setFeedback(`Found ${models.length} local model${models.length === 1 ? "" : "s"}.`, "success");
    }
  } catch (error) {
    populateModelOptions([{ name: state.settings.model }], state.settings.model);
    if (!silent) {
      setFeedback(error.message, "error");
    }
  }
}

async function testConnection() {
  state.settings = readSettingsForm();
  persistSettings();
  setFeedback("Checking Ollama connection...", "");
  try {
    const result = await window.desktopBridge.testConnection(state.settings);
    setFeedback(`Connection ok. ${result.modelCount} model${result.modelCount === 1 ? "" : "s"} available.`, "success");
  } catch (error) {
    setFeedback(error.message, "error");
  }
}

function populateModelOptions(models, selectedModel) {
  const entries = Array.isArray(models) ? models : [];
  const names = entries.map((model) => typeof model === "string" ? model : model.name).filter(Boolean);
  if (selectedModel && !names.includes(selectedModel)) {
    names.unshift(selectedModel);
  }

  elements.modelSelect.textContent = "";
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = name === selectedModel;
    elements.modelSelect.append(option);
  }
}

function setFeedback(message, tone) {
  elements.settingsFeedback.textContent = message;
  elements.settingsFeedback.className = `feedback${tone ? ` ${tone}` : ""}`;
}

function syncAddressBar() {
  const tab = getActiveTab();
  elements.addressInput.value = formatDisplayUrl(tab?.url || "");
}

function updateBrowserContext() {
  const tab = getActiveTab();
  if (!tab) {
    elements.activePageLabel.textContent = "No page loaded yet.";
    return;
  }

  const displayUrl = formatDisplayUrl(tab.url || "");
  elements.activePageLabel.textContent = tab.loading
    ? `Loading ${displayUrl || tab.title || "page"}...`
    : `${tab.title || "Untitled"} · ${displayUrl}`;

  elements.backButton.disabled = !(tab.domReady && tab.webview?.canGoBack?.());
  elements.forwardButton.disabled = !(tab.domReady && tab.webview?.canGoForward?.());
}

function getActiveTab() {
  return state.tabs.find((tab) => tab.id === state.activeTabId) || null;
}

async function navigateActiveTab(input) {
  const tab = getActiveTab();
  if (!tab) {
    return;
  }
  await waitForWebviewDomReady(tab.webview);
  const destination = normalizeDestination(input);
  tab.loading = true;
  tab.domReady = false;
  tab.url = destination;
  updateBrowserContext();
  await tab.webview.loadURL(destination);
}

async function reloadActiveTab() {
  const tab = getActiveTab();
  if (!tab) {
    return;
  }
  await waitForWebviewDomReady(tab.webview);
  tab.webview.reload();
  await waitForLoad(tab.webview);
}

async function goBack() {
  const tab = getActiveTab();
  if (tab?.domReady && tab.webview?.canGoBack()) {
    tab.webview.goBack();
    await waitForLoad(tab.webview, 10000, true);
  }
}

async function goForward() {
  const tab = getActiveTab();
  if (tab?.domReady && tab.webview?.canGoForward()) {
    tab.webview.goForward();
    await waitForLoad(tab.webview, 10000, true);
  }
}

async function runAgentTask(taskValue) {
  if (state.running) {
    pushLog("warn", "A task is already running.");
    return;
  }

  const task = String(taskValue || "").trim();
  if (!task) {
    pushLog("warn", "Enter a task before starting the agent.");
    return;
  }

  if (!getActiveTab()) {
    pushLog("error", "No active tab is available.");
    return;
  }

  state.settings = readSettingsForm();
  persistSettings();
  state.running = true;
  state.abortRequested = false;
  state.currentTask = task;
  state.lastResult = "Working through the current task.";
  state.currentStep = { step: 0, total: state.settings.maxIterations, label: "starting" };
  appendConversation("user", task);
  elements.taskInput.value = "";
  renderState();

  pushLog("info", `Queued message: ${task}`);

  const messages = buildConversationMessages();

  try {
    for (let step = 1; step <= state.settings.maxIterations; step += 1) {
      ensureNotCancelled();
      state.currentStep = { step, total: state.settings.maxIterations, label: "thinking" };
      renderState();
      pushLog("info", `Agent step ${step}/${state.settings.maxIterations}`);

      const response = await window.desktopBridge.chatWithOllama({
        settings: state.settings,
        messages,
        tools: TOOL_DEFINITIONS
      });

      const assistantMessage = normalizeAssistantMessage(response.message);
      messages.push(assistantMessage);

      const reasoningSummary = buildReasoningSummary(assistantMessage);
      if (reasoningSummary) {
        pushLog("reasoning", reasoningSummary);
      }

      if (assistantMessage.content) {
        pushLog("assistant", assistantMessage.content);
      }

      const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];
      if (!toolCalls.length) {
        if (!assistantMessage.content) {
          throw new Error("The model returned neither content nor tool calls.");
        }

        state.running = false;
        state.currentStep = null;
        state.lastResult = assistantMessage.content;
        appendConversation("assistant", assistantMessage.content);
        pushLog("success", assistantMessage.content);
        renderState();
        return;
      }

      for (const toolCall of toolCalls) {
        ensureNotCancelled();
        const name = toolCall?.function?.name;
        const args = normalizeArguments(toolCall?.function?.arguments);
        if (!name) {
          continue;
        }

        if (state.settings.approvalMode === "manual" && MUTATING_TOOLS.has(name)) {
          const approved = window.confirm(`Approve browser action?\n\n${describeToolUse(name, args)}`);
          if (!approved) {
            const deniedResult = { ok: false, error: "Action denied by user." };
            messages.push({ role: "tool", tool_name: name, content: JSON.stringify(deniedResult) });
            pushLog("warn", `Denied ${name}.`);
            continue;
          }
        }

        state.currentStep = { step, total: state.settings.maxIterations, label: name };
        renderState();
        pushLog("tool", `Tool: ${name}`);

        let result;
        try {
          result = await executeTool(name, args);
        } catch (error) {
          result = { ok: false, error: error.message };
        }

        messages.push({
          role: "tool",
          tool_name: name,
          content: JSON.stringify(result)
        });

        pushLog(result.ok === false ? "error" : "tool", summarizeToolResult(name, result));
      }
    }

    throw new Error(`Stopped after ${state.settings.maxIterations} steps without a final answer.`);
  } catch (error) {
    state.lastResult = error.message;
    appendConversation("assistant", `I ran into an error while working on that: ${error.message}`);
    pushLog("error", error.message);
  } finally {
    state.running = false;
    state.abortRequested = false;
    state.currentStep = null;
    renderState();
  }
}

async function executeTool(name, args) {
  switch (name) {
    case "get_active_tab":
      return {
        ok: true,
        currentTabId: getActiveTab()?.id || null,
        tab: serializeTab(getActiveTab()),
        summary: `Active tab is "${getActiveTab()?.title || getActiveTab()?.url || "Untitled"}".`
      };
    case "list_tabs":
      return {
        ok: true,
        tabs: state.tabs.map(serializeTab),
        summary: `Found ${state.tabs.length} tab${state.tabs.length === 1 ? "" : "s"} in this browser.`
      };
    case "switch_to_tab":
      return switchToTab(args);
    case "open_new_tab":
      return openNewTab(args);
    case "open_or_search":
      return openOrSearch(args);
    case "navigate_to":
      return navigateTo(args);
    case "reload_tab":
      await reloadActiveTab();
      return { ok: true, currentTabId: getActiveTab()?.id || null, summary: `Reloaded ${getActiveTab()?.title || "the current tab"}.` };
    case "go_back":
      await goBack();
      return { ok: true, currentTabId: getActiveTab()?.id || null, summary: `Moved back in ${getActiveTab()?.title || "the current tab"}.` };
    case "go_forward":
      await goForward();
      return { ok: true, currentTabId: getActiveTab()?.id || null, summary: `Moved forward in ${getActiveTab()?.title || "the current tab"}.` };
    case "close_current_tab":
      return closeCurrentTab();
    case "inspect_page":
      return inspectPage(args);
    case "click_element":
      return runPageCommand("clickElement", { elementId: args.elementId });
    case "type_into_element":
      return runPageCommand("typeIntoElement", {
        elementId: args.elementId,
        text: String(args.text || ""),
        clearFirst: args.clearFirst !== false,
        submit: args.submit === true
      });
    case "hover_element":
      return runPageCommand("hoverElement", { elementId: args.elementId });
    case "move_mouse_to_element":
      return runPageCommand("moveMouseToElement", { elementId: args.elementId });
    case "move_mouse_to_coordinates":
      return runPageCommand("moveMouseToCoordinates", {
        x: args.x,
        y: args.y,
        label: args.label || ""
      });
    case "scroll_page":
      return runPageCommand("scrollPage", {
        direction: args.direction === "up" ? "up" : "down",
        amount: normalizeAmount(args.amount)
      });
    case "read_element_text":
      return runPageCommand("readElementText", { elementId: args.elementId });
    case "wait":
      await sleep(clampInteger(args.milliseconds, 100, 10000, 1000));
      return { ok: true, summary: `Waited ${clampInteger(args.milliseconds, 100, 10000, 1000)} ms.` };
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

function switchToTab(args) {
  const requestedId = String(args.tabId || "");
  let tab = requestedId ? state.tabs.find((entry) => entry.id === requestedId) : null;
  if (!tab && args.query) {
    const query = String(args.query).toLowerCase();
    tab = state.tabs.find((entry) =>
      (entry.title || "").toLowerCase().includes(query) ||
      (entry.url || "").toLowerCase().includes(query)
    );
  }

  if (!tab) {
    return { ok: false, error: "Unable to find a matching tab." };
  }

  selectTab(tab.id);
  return {
    ok: true,
    currentTabId: tab.id,
    tab: serializeTab(tab),
    summary: `Switched to "${tab.title || tab.url || "Untitled"}".`
  };
}

function openNewTab(args) {
  const nextTab = createTab(args.url || START_PAGE_URL);
  if (args.active === false) {
    const previous = state.tabs.find((tab) => tab.id !== nextTab.id);
    if (previous) {
      selectTab(previous.id);
    }
  }

  return {
    ok: true,
    currentTabId: nextTab.id,
    tab: serializeTab(nextTab),
    summary: args.url ? `Opened a new tab at ${normalizeDestination(args.url)}.` : "Opened a new tab."
  };
}

async function openOrSearch(args) {
  await navigateActiveTab(String(args.query || ""));
  const tab = getActiveTab();
  return {
    ok: true,
    currentTabId: tab?.id || null,
    tab: serializeTab(tab),
    summary: isLikelyUrlQuery(args.query)
      ? `Opened ${tab?.url || normalizeDestination(args.query)}.`
      : `Searched Google for "${args.query}".`
  };
}

async function navigateTo(args) {
  const url = String(args.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "navigate_to requires an absolute http or https URL." };
  }

  await navigateActiveTab(url);
  const tab = getActiveTab();
  return {
    ok: true,
    currentTabId: tab?.id || null,
    tab: serializeTab(tab),
    summary: `Navigated to ${tab?.url || url}.`
  };
}

function closeCurrentTab() {
  const tab = getActiveTab();
  if (!tab) {
    return { ok: false, error: "No active tab selected." };
  }
  const title = tab.title || tab.url || "tab";
  closeTab(tab.id);
  return {
    ok: true,
    currentTabId: getActiveTab()?.id || null,
    tab: serializeTab(getActiveTab()),
    summary: `Closed "${title}".`
  };
}

async function inspectPage(args) {
  const result = await runPageCommand("snapshot", {
    includeText: args.includeText !== false,
    includeMetadata: args.includeMetadata !== false
  });
  return {
    ok: true,
    currentTabId: getActiveTab()?.id || null,
    page: result,
    summary: `Inspected ${getActiveTab()?.title || getActiveTab()?.url || "page"}. Found ${result.interactiveElements?.length || 0} interactive elements.`
  };
}

async function runPageCommand(type, payload) {
  const tab = getActiveTab();
  if (!tab?.webview) {
    throw new Error("No active browser tab is available.");
  }

  await waitForDomReady(tab.webview);
  const result = await tab.webview.executeJavaScript(createPageCommandScript({
    type,
    ...payload
  }), true);

  return {
    ok: result.ok !== false,
    currentTabId: tab.id,
    ...result
  };
}

async function waitForDomReady(webview) {
  await waitForWebviewDomReady(webview);
  if (webview.isLoading()) {
    await waitForLoad(webview);
  }
}

function waitForWebviewDomReady(webview, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the webview to initialize."));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      webview.removeEventListener("dom-ready", handleReady);
    };

    const handleReady = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    webview.addEventListener("dom-ready", handleReady);

    try {
      webview.getWebContentsId();
      handleReady();
    } catch {
      // The webview is not ready yet; wait for the event.
    }
  });
}

function waitForLoad(webview, timeoutMs = 15000, allowNoNavigation = false) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      cleanup();
      if (allowNoNavigation) {
        resolve();
      } else {
        reject(new Error("Timed out waiting for navigation to complete."));
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      webview.removeEventListener("did-stop-loading", handleStop);
      webview.removeEventListener("did-fail-load", handleFail);
    };

    const handleStop = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const handleFail = (event) => {
      if (event.errorCode === -3 && allowNoNavigation) {
        handleStop();
        return;
      }
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(event.errorDescription || "Navigation failed."));
    };

    webview.addEventListener("did-stop-loading", handleStop);
    webview.addEventListener("did-fail-load", handleFail);

    if (!webview.isLoading()) {
      handleStop();
    }
  });
}

function normalizeAssistantMessage(message = {}) {
  return {
    role: "assistant",
    content: String(message.content || "").trim(),
    tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : []
  };
}

function normalizeArguments(argumentsValue) {
  if (!argumentsValue) {
    return {};
  }

  if (typeof argumentsValue === "string") {
    try {
      return JSON.parse(argumentsValue);
    } catch {
      return {};
    }
  }

  return argumentsValue;
}

function buildReasoningSummary(message) {
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length) {
    const steps = toolCalls
      .slice(0, 3)
      .map((toolCall) => {
        const name = toolCall?.function?.name;
        const args = normalizeArguments(toolCall?.function?.arguments);
        return name ? describeToolUse(name, args).toLowerCase() : null;
      })
      .filter(Boolean);

    return steps.length
      ? `Decision trace: next I will ${steps.join(", then ")}.`
      : "Decision trace: preparing the next browser action.";
  }

  if (message.content) {
    return "Decision trace: I have enough information to answer without another browser action.";
  }

  return "";
}

function describeToolUse(name, args) {
  switch (name) {
    case "click_element":
      return `click element ${args.elementId}`;
    case "type_into_element":
      return `type into ${args.elementId}: "${truncate(args.text, 80)}"`;
    case "open_or_search":
      return `open or search "${truncate(args.query, 80)}"`;
    case "navigate_to":
      return `navigate to ${args.url}`;
    case "move_mouse_to_element":
      return `move the cursor to ${args.elementId}`;
    case "move_mouse_to_coordinates":
      return `move the cursor to (${args.x}, ${args.y})`;
    case "hover_element":
      return `hover over ${args.elementId}`;
    default:
      return `run ${name}`;
  }
}

function summarizeToolResult(name, result) {
  if (result.summary) {
    return `${name}: ${result.summary}`;
  }
  if (result.error) {
    return `${name} failed: ${result.error}`;
  }
  return `${name}: completed.`;
}

function buildConversationMessages() {
  const tab = getActiveTab();
  const activeTabLine = tab
    ? `Active tab right now: ${tab.title || "Untitled"} (${formatDisplayUrl(tab.url || "") || "no url"}).`
    : "No active tab is available.";

  const conversationMessages = state.conversation.map((entry, index) => {
    if (entry.role !== "user") {
      return {
        role: "assistant",
        content: entry.content
      };
    }

    if (index === state.conversation.length - 1) {
      return {
        role: "user",
        content: [
          entry.content,
          "",
          activeTabLine,
          "Use browser tools when you need page facts or actions.",
          "If I ask what you see or ask for a summary, inspect the page first."
        ].join("\n")
      };
    }

    return {
      role: "user",
      content: entry.content
    };
  });

  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationMessages
  ];
}

function renderState() {
  elements.runTaskButton.disabled = state.running;
  elements.stopTaskButton.disabled = !state.running;
  elements.clearConversationButton.disabled = state.running || !state.conversation.length;
  elements.statusPill.textContent = state.running ? "Running" : "Idle";
  elements.statusPill.className = `status-pill ${state.running ? "running" : "idle"}`;
  elements.stepIndicator.textContent = state.currentStep
    ? `Step ${state.currentStep.step}/${state.currentStep.total} · ${state.currentStep.label}`
    : "Ready";
  elements.statusCopy.textContent = state.running
    ? state.currentTask || "Working through the current task."
    : state.lastResult || "Waiting for a task.";
  renderTabs();
  renderConversation();
  renderLogs();
  updateBrowserContext();
  window.requestAnimationFrame(updateAgentScrollButtons);
}

function renderConversation() {
  elements.conversation.textContent = "";

  if (!state.conversation.length) {
    const empty = document.createElement("div");
    empty.className = "conversation-empty";
    empty.textContent = "Chat directly with the assistant here. Ask it to summarize the page, explain what it sees, or take browser actions for you.";
    elements.conversation.append(empty);
    return;
  }

  for (const entry of state.conversation) {
    const row = document.createElement("div");
    row.className = `conversation-message ${entry.role}`;

    const bubble = document.createElement("div");
    bubble.className = "conversation-bubble";

    const meta = document.createElement("div");
    meta.className = "conversation-meta";
    meta.textContent = `${entry.role === "user" ? "You" : "Assistant"} · ${formatTime(entry.timestamp)}`;

    const content = document.createElement("div");
    content.textContent = entry.content;

    bubble.append(meta, content);
    row.append(bubble);
    elements.conversation.append(row);
  }

  window.requestAnimationFrame(() => {
    elements.conversation.scrollTop = elements.conversation.scrollHeight;
  });
}

function renderLogs() {
  elements.logs.textContent = "";
  const entries = state.logs.slice().reverse();

  if (!entries.length) {
    const item = document.createElement("li");
    item.className = "log-item";
    item.innerHTML = `
      <div class="log-meta">Idle</div>
      <div class="log-content">No activity yet. Start a task and the decision trace will show up here.</div>
    `;
    elements.logs.append(item);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("li");
    item.className = `log-item ${entry.level}`;

    const meta = document.createElement("div");
    meta.className = "log-meta";
    meta.textContent = `${levelIcon(entry.level)} ${entry.level} · ${formatTime(entry.timestamp)}`;

    const content = document.createElement("div");
    content.className = "log-content";
    content.textContent = entry.message;

    item.append(meta, content);
    elements.logs.append(item);
  }
}

function pushLog(level, message) {
  state.logs.push({
    level,
    message,
    timestamp: new Date().toISOString()
  });

  if (state.logs.length > 400) {
    state.logs = state.logs.slice(-400);
  }

  renderState();
}

function appendConversation(role, content) {
  const text = String(content || "").trim();
  if (!text) {
    return;
  }

  state.conversation.push({
    role: role === "user" ? "user" : "assistant",
    content: text,
    timestamp: new Date().toISOString()
  });

  if (state.conversation.length > 24) {
    state.conversation = state.conversation.slice(-24);
  }

  persistConversation();
}

function ensureNotCancelled() {
  if (state.abortRequested) {
    throw new Error("Stopped by user.");
  }
}

function defineTool(name, description, properties = {}, required = []) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        required,
        properties
      }
    }
  };
}

function serializeTab(tab) {
  if (!tab) {
    return null;
  }
  return {
    id: tab.id,
    title: tab.title || "",
    url: tab.url || "",
    displayUrl: formatDisplayUrl(tab.url || ""),
    loading: tab.loading === true
  };
}

function formatDisplayUrl(value) {
  const url = String(value || "");
  if (!url) {
    return "";
  }
  if (url === START_PAGE_URL) {
    return START_PAGE_DISPLAY_URL;
  }
  return url;
}

function normalizeDestination(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return START_PAGE_URL;
  }
  if (trimmed === START_PAGE_DISPLAY_URL) {
    return START_PAGE_URL;
  }
  if (trimmed === START_PAGE_URL || trimmed.startsWith("file://")) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function isLikelyUrlQuery(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith("file://")) {
    return true;
  }
  return /^https?:\/\//i.test(trimmed) || /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed);
}

function normalizeAmount(value) {
  return clampNumber(value, 0.1, 2, 0.8);
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

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
}

function levelIcon(level) {
  switch (level) {
    case "success":
      return "✓";
    case "error":
      return "✕";
    case "warn":
      return "!";
    case "tool":
      return "⚙";
    case "reasoning":
      return "🧭";
    case "assistant":
      return "◆";
    default:
      return "›";
  }
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function showBootError(message) {
  let panel = document.querySelector(".boot-error");
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "boot-error";
    document.body.append(panel);
  }

  panel.innerHTML = `
    <strong>Browser shell failed to finish loading</strong>
    <div>${escapeHtml(String(message || "Unknown error"))}</div>
  `;
}

function startIntroAnimation() {
  const overlay = elements.introOverlay;
  if (!overlay) {
    return;
  }

  overlay.classList.remove("is-hidden");
  window.setTimeout(() => {
    overlay.classList.add("is-hidden");
  }, 2400);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
