import { DESKTOP_BROWSER_TOOLS, getBrowserToolDefinitionMap, TOOL_RUNTIMES } from "../../src/shared/tool-schema.js";
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
  maxIterationsAuto: true,
  requestTimeoutMs: 120000,
  approvalMode: "auto",
  trustedOrigins: ""
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

const TOOLS_WITH_PAGE_STATE_DIFF = new Set([
  "switch_to_tab",
  "open_new_tab",
  "open_or_search",
  "navigate_to",
  "reload_tab",
  "go_back",
  "go_forward",
  "close_current_tab",
  "click_element",
  "type_into_element",
  "hover_element",
  "scroll_page"
]);

const TOOL_BASELINE_REQUIRED = new Set([
  "click_element",
  "type_into_element",
  "hover_element",
  "scroll_page",
  "open_or_search",
  "navigate_to",
  "reload_tab",
  "go_back",
  "go_forward",
  "switch_to_tab",
  "open_new_tab",
  "close_current_tab"
]);

const VISION_MODEL_PATTERNS = [
  /vision/i,
  /llava/i,
  /bakllava/i,
  /qwen2(\.5)?-vl/i,
  /minicpm[-:]?v/i,
  /internvl/i,
  /cogvlm/i,
  /pixtral/i,
  /molmo/i,
  /moondream/i,
  /gemma3/i,
  /llama3(\.2)?[-:]vision/i
];

const TOOL_DEFINITIONS = DESKTOP_BROWSER_TOOLS;
const TOOL_DEFINITION_MAP = getBrowserToolDefinitionMap(TOOL_RUNTIMES.DESKTOP);

const SYSTEM_PROMPT = [
  "You are an autonomous browser operator inside a local desktop browser shell.",
  "The user may ask for browser actions, summaries, explanations, or help understanding what is on the current page.",
  "Complete the user's request by using the available tools. Inspect the page before taking actions, and inspect before answering questions about what is visible.",
  "inspect_page returns ranked elements, form and landmark summaries, OCR text, and may attach screenshot grounding for vision-capable models.",
  "Action tools return explicit page-state diffs. Use those diffs instead of guessing what changed.",
  "A visible cursor appears during movement, hover, typing, and click actions. Use it deliberately so the user can follow what will happen next.",
  "Never invent element ids or tab ids. Use tool outputs exactly as returned.",
  "Keep actions small and verifiable. Re-inspect after navigation or major actions.",
  "Respond conversationally and clearly. When the request is complete, answer like a helpful assistant and include any important caveats."
].join(" ");

const PLANNER_SYSTEM_PROMPT = [
  "You are the planner for a browser automation system.",
  "Return JSON only with this shape: {\"summary\":string,\"steps\":[{\"objective\":string,\"successCriteria\":string}]}",
  "Create 1 to 6 short, testable browser steps.",
  "Each step must have observable success criteria.",
  "Do not call tools, do not execute the task, and do not produce prose outside the JSON."
].join(" ");

const EXECUTOR_SYSTEM_PROMPT = [
  "You are the executor for a browser automation system.",
  "You may use browser tools, but only to complete the current step.",
  "Do not invent ids or page facts. Inspect when you need evidence.",
  "For element tools, prefer the exact element id from inspect_page. If the page likely changed, include a short elementHint such as 'email field' or 'Continue button'.",
  "Keep actions small and verifiable.",
  "When the current step is complete, reply with a concise completion summary instead of more tool calls."
].join(" ");

const VERIFIER_SYSTEM_PROMPT = [
  "You are the verifier for a browser automation system.",
  "Return JSON only with this shape: {\"verdict\":\"complete|retry|blocked\",\"reason\":string,\"evidence\":string,\"nextActionHint\":string}.",
  "Use the step objective, success criteria, executor summary, tool results, and latest page observation.",
  "Only return complete when the evidence clearly satisfies the success criteria."
].join(" ");

const FINALIZER_SYSTEM_PROMPT = [
  "You are the final response generator for a browser automation system.",
  "Summarize the completed work clearly for the user.",
  "Mention blockers or caveats if the task was not fully completed.",
  "Write naturally in plain prose.",
  "Do not use headings like 'Task Summary', 'Blockers', or 'Recommendation' unless the user explicitly asked for a structured report."
].join(" ");

const MAX_PLAN_STEPS = 6;
const MAX_STEP_RETRIES = 2;
const MAX_EXECUTOR_TURNS_PER_ATTEMPT = 4;
const AGENT_MEMORY_KEY = "desktopAgentMemory";
const TELEMETRY_KEY = "desktopTelemetry";
const MAX_MEMORY_DOMAINS = 10;
const MAX_MEMORY_WORKFLOWS = 12;
const MAX_MEMORY_CHECKPOINTS = 8;
const MEMORY_TASK_TOKEN_LIMIT = 8;
const TELEMETRY_EVENT_LIMIT = 120;
const WORKFLOW_TASK_SIGNAL_WEIGHT = 4;
const WORKFLOW_PAGE_SIGNAL_WEIGHT = 1.25;
const WORKFLOW_NEGATIVE_SIGNAL_WEIGHT = 5;
const WORKFLOW_SELECTION_SCORE_THRESHOLD = 3;
const WORKFLOW_CONFIDENCE_THRESHOLD = 0.56;
const WORKFLOW_CANDIDATE_LIMIT = 3;

const BUILTIN_WORKFLOW_RECIPES = [
  {
    id: "search-and-summarize",
    name: "Search and summarize",
    matchKeywords: ["search", "find", "look up", "research", "learn about", "read about"],
    taskSignals: ["search", "find", "look up", "research", "learn about", "read about"],
    pageSignals: ["search", "results", "google", "docs", "article"],
    negativeTaskSignals: ["sign in", "log in", "login", "authenticate", "fill out", "submit payment", "monitor", "watch this page"],
    inputs: ["topic or question"],
    outputs: ["relevant destination page", "short summary"],
    successConditions: ["a relevant result or page is opened", "the assistant can summarize the result"],
    retryRules: ["re-inspect the current page", "refine the search query", "open a stronger result"],
    steps: ["Inspect the current page or open search", "Navigate to a likely result", "Inspect the chosen page", "Summarize what was found"]
  },
  {
    id: "sign-in",
    name: "Sign in",
    matchKeywords: ["sign in", "log in", "login", "authenticate"],
    taskSignals: ["sign in", "sign into", "log in", "log into", "login", "authenticate"],
    pageSignals: ["login", "sign in", "password", "authentication"],
    negativeTaskSignals: ["explain", "summarize", "what is this", "what fields", "describe"],
    inputs: ["site", "username", "password or auth step"],
    outputs: ["signed-in session or user escalation"],
    successConditions: ["credentials fields are filled", "the login action completes", "the site moves past the auth wall"],
    retryRules: ["re-inspect the login form", "reload once if the form stalls", "escalate to the user for CAPTCHA or MFA"],
    steps: ["Inspect the login page", "Fill credentials carefully", "Submit the form with approval", "Verify that the authenticated state changed"]
  },
  {
    id: "fill-and-submit",
    name: "Fill and submit form",
    matchKeywords: ["fill", "fill out", "submit", "apply", "complete form", "send message"],
    taskSignals: ["fill", "fill out", "submit", "apply", "complete form", "send message", "send this", "enter my"],
    pageSignals: ["form", "apply", "contact", "checkout", "compose", "message"],
    negativeTaskSignals: ["explain", "summarize", "what is this", "what fields", "describe"],
    inputs: ["field values"],
    outputs: ["completed form submission"],
    successConditions: ["required fields are filled", "submit action completes", "confirmation or state change appears"],
    retryRules: ["re-inspect missing fields", "scroll or switch tabs if the form moved", "reload only if the form is clearly stalled"],
    steps: ["Inspect the form and required fields", "Fill the required inputs", "Submit with policy checks", "Verify confirmation or changed page state"]
  },
  {
    id: "compare-options",
    name: "Compare options",
    matchKeywords: ["compare", "difference", "best", "versus", "vs", "choose"],
    taskSignals: ["compare", "difference", "best", "versus", "vs", "choose", "better", "which one"],
    pageSignals: ["compare", "pricing", "plans", "options"],
    negativeTaskSignals: ["sign in", "log in"],
    inputs: ["items or pages to compare"],
    outputs: ["structured comparison", "recommendation"],
    successConditions: ["multiple relevant pages or sections are inspected", "important differences are extracted", "a comparison summary is returned"],
    retryRules: ["open another tab for additional options", "re-inspect the comparison page", "switch tabs when context drifts"],
    steps: ["Identify the items to compare", "Inspect each relevant page or tab", "Extract key differences", "Summarize the comparison"]
  },
  {
    id: "monitor-page",
    name: "Monitor page",
    matchKeywords: ["monitor", "watch", "track", "check repeatedly", "notify"],
    taskSignals: ["monitor", "watch", "track", "check repeatedly", "notify", "alert me", "keep an eye on"],
    pageSignals: ["tracking", "dashboard", "alerts", "status"],
    negativeTaskSignals: ["sign in", "log in"],
    inputs: ["target condition"],
    outputs: ["latest observed state", "condition status"],
    successConditions: ["the target page is loaded", "the watch condition is checked", "the current state is reported"],
    retryRules: ["reload carefully", "re-inspect when layout changes", "pause and escalate on auth walls or CAPTCHAs"],
    steps: ["Open the target page", "Inspect the watch region", "Check whether the target condition is present", "Report the current state"]
  },
  {
    id: "navigate-and-explain",
    name: "Navigate and explain",
    matchKeywords: ["open", "go to", "navigate", "explain", "describe", "summarize", "what is this"],
    taskSignals: ["open", "go to", "navigate", "explain", "describe", "summarize", "inspect", "walk me through", "what is this", "what's this", "what fields", "what is on this page"],
    pageSignals: ["docs", "overview", "page", "help"],
    negativeTaskSignals: ["search", "find", "look up", "research", "learn about", "read about", "compare", "versus", "vs", "monitor", "watch"],
    inputs: ["destination or current page"],
    outputs: ["landed destination", "page explanation"],
    successConditions: ["the target page is visible", "the page structure is inspected", "the assistant can explain what it sees"],
    retryRules: ["re-inspect after navigation", "go back if the wrong destination opened", "open a new tab when needed"],
    steps: ["Navigate to the target page", "Inspect the page structure", "Explain the visible content or next actions"]
  }
];

const FAILURE_CATEGORIES = {
  captcha: "CAPTCHA or human verification wall",
  auth_wall: "Authentication wall",
  missing_element: "Missing or moved element",
  ambiguous_element: "Ambiguous element match",
  navigation: "Navigation or load failure",
  no_state_change: "Expected state change did not happen",
  input_rejected: "Input was rejected by the page",
  invalid_arguments: "Tool arguments were invalid",
  wrong_domain: "Unexpected domain or tab context",
  policy_blocked: "Safety policy blocked the action",
  approval_denied: "User denied approval",
  general: "General execution failure"
};

const SENSITIVE_ACTION_PATTERNS = [
  /buy/i,
  /purchase/i,
  /checkout/i,
  /pay/i,
  /place order/i,
  /submit payment/i,
  /delete/i,
  /remove/i,
  /close account/i,
  /log ?out/i,
  /sign ?out/i,
  /transfer/i,
  /wire/i,
  /cancel subscription/i
];

const elements = {
  windowShell: document.getElementById("window-shell"),
  appVersion: document.getElementById("app-version"),
  tabs: document.getElementById("tabs"),
  newTabButton: document.getElementById("new-tab-button"),
  assistantSettingsButton: document.getElementById("assistant-settings-button"),
  toggleAgentButton: document.getElementById("toggle-agent-button"),
  introOverlay: document.getElementById("intro-overlay"),
  addressForm: document.getElementById("address-form"),
  addressChip: document.getElementById("address-chip"),
  addressInput: document.getElementById("address-input"),
  addressStatus: document.getElementById("address-status"),
  backButton: document.getElementById("back-button"),
  forwardButton: document.getElementById("forward-button"),
  reloadButton: document.getElementById("reload-button"),
  homeButton: document.getElementById("home-button"),
  browserStack: document.getElementById("browser-stack"),
  activePageLabel: document.getElementById("active-page-label"),
  pageProgress: document.getElementById("page-progress"),
  pageBadge: document.getElementById("page-badge"),
  agentPane: document.getElementById("agent-pane"),
  assistantSettingsPanel: document.getElementById("assistant-settings-panel"),
  closeSettingsButton: document.getElementById("close-settings-button"),
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
  modelGuidance: document.getElementById("model-guidance"),
  temperatureInput: document.getElementById("temperature-input"),
  iterationsAutoButton: document.getElementById("iterations-auto-button"),
  iterationsInput: document.getElementById("iterations-input"),
  iterationsGuidance: document.getElementById("iterations-guidance"),
  trustedOriginsInput: document.getElementById("trusted-origins-input"),
  policyGuidance: document.getElementById("policy-guidance"),
  saveSettingsButton: document.getElementById("save-settings-button"),
  refreshModelsButton: document.getElementById("refresh-models-button"),
  testConnectionButton: document.getElementById("test-connection-button"),
  settingsFeedback: document.getElementById("settings-feedback"),
  telemetryTaskSuccess: document.getElementById("telemetry-task-success"),
  telemetryStepSuccess: document.getElementById("telemetry-step-success"),
  telemetryApprovalRate: document.getElementById("telemetry-approval-rate"),
  telemetryRecoveryRate: document.getElementById("telemetry-recovery-rate"),
  telemetryWorkflowSummary: document.getElementById("telemetry-workflow-summary"),
  telemetryLastFailure: document.getElementById("telemetry-last-failure"),
  clearLogsButton: document.getElementById("clear-logs-button"),
  logs: document.getElementById("logs")
};

const state = {
  settings: loadSettings(),
  preferences: loadPreferences(),
  tabs: [],
  activeTabId: null,
  conversation: loadConversation(),
  memory: loadAgentMemory(),
  telemetry: loadTelemetry(),
  running: false,
  abortRequested: false,
  currentTask: "",
  currentStep: null,
  lastResult: "Waiting for a task.",
  logs: [],
  modelCatalog: []
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
    syncMemoryPreferencesFromSettings();
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

    announceResumableMemory();

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
  elements.assistantSettingsButton.addEventListener("click", () => {
    toggleSettingsPanel();
  });
  elements.toggleAgentButton.addEventListener("click", () => {
    state.preferences.agentPaneOpen = !state.preferences.agentPaneOpen;
    if (!state.preferences.agentPaneOpen) {
      state.preferences.settingsPanelOpen = false;
    }
    persistPreferences();
    applyLayoutState();
  });
  elements.closeSettingsButton.addEventListener("click", () => {
    toggleSettingsPanel(false);
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
  elements.addressInput.addEventListener("input", () => {
    updateAddressMeta(elements.addressInput.value);
  });
  elements.addressInput.addEventListener("focus", () => {
    updateAddressMeta(elements.addressInput.value);
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
  elements.modelSelect.addEventListener("change", () => {
    updateModelGuidance(state.modelCatalog, elements.modelSelect.value);
  });
  elements.iterationsAutoButton.addEventListener("click", () => {
    state.settings.maxIterationsAuto = state.settings.maxIterationsAuto === false;
    updateIterationsModeUi();
  });
  elements.trustedOriginsInput.addEventListener("input", () => {
    updatePolicyGuidance(elements.trustedOriginsInput.value);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.preferences.settingsPanelOpen) {
      event.preventDefault();
      toggleSettingsPanel(false);
      return;
    }

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
    lastObservedPage: null,
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
    recordRecentDomainVisit(tab.url, tab.title);
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
    button.title = buildTabButtonTitle(tab);
    button.setAttribute("aria-label", buildTabButtonTitle(tab));

    const indicator = document.createElement("span");
    indicator.className = `tab-indicator ${tab.loading ? "loading" : classifyPageBadge(tab.url)}`;
    indicator.setAttribute("aria-hidden", "true");

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

    button.append(indicator, title, close);
    button.addEventListener("click", () => selectTab(tab.id));
    elements.tabs.append(button);
  }
}

function hydrateSettingsForm() {
  elements.baseUrlInput.value = state.settings.baseUrl;
  elements.apiKeyInput.value = state.settings.apiKey;
  elements.temperatureInput.value = String(state.settings.temperature);
  elements.iterationsInput.value = String(state.settings.maxIterations);
  updateIterationsModeUi();
  elements.trustedOriginsInput.value = state.settings.trustedOrigins || "";
  state.modelCatalog = normalizeModelCatalog([{ name: state.settings.model }], state.settings.model);
  populateModelOptions(state.modelCatalog, state.settings.model);
  updatePolicyGuidance(elements.trustedOriginsInput.value);
}

function readSettingsForm() {
  return {
    ...state.settings,
    baseUrl: elements.baseUrlInput.value.trim() || DEFAULT_SETTINGS.baseUrl,
    apiKey: elements.apiKeyInput.value.trim(),
    model: elements.modelSelect.value || state.settings.model || DEFAULT_SETTINGS.model,
    temperature: clampNumber(elements.temperatureInput.value, 0, 2, DEFAULT_SETTINGS.temperature),
    maxIterationsAuto: state.settings.maxIterationsAuto !== false,
    maxIterations: clampInteger(elements.iterationsInput.value, 2, 30, DEFAULT_SETTINGS.maxIterations),
    trustedOrigins: normalizeTrustedOriginsInput(elements.trustedOriginsInput.value),
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
      agentPaneOpen: parsed.agentPaneOpen !== false,
      settingsPanelOpen: false
    };
  } catch {
    return {
      agentPaneOpen: true,
      settingsPanelOpen: false
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

function loadAgentMemory() {
  try {
    const raw = localStorage.getItem(AGENT_MEMORY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeAgentMemory(parsed);
  } catch {
    return createEmptyAgentMemory();
  }
}

function createEmptyAgentMemory() {
  return {
    version: 1,
    activeGoal: null,
    userPreferences: {
      assistant: {}
    },
    recentDomains: [],
    workflows: [],
    checkpoints: []
  };
}

function normalizeAgentMemory(parsed) {
  const memory = createEmptyAgentMemory();
  if (!parsed || typeof parsed !== "object") {
    return memory;
  }

  memory.activeGoal = parsed.activeGoal && typeof parsed.activeGoal === "object" ? parsed.activeGoal : null;
  memory.userPreferences = parsed.userPreferences && typeof parsed.userPreferences === "object"
    ? {
      assistant: parsed.userPreferences.assistant && typeof parsed.userPreferences.assistant === "object"
        ? parsed.userPreferences.assistant
        : {}
    }
    : memory.userPreferences;
  memory.recentDomains = Array.isArray(parsed.recentDomains) ? parsed.recentDomains.slice(0, MAX_MEMORY_DOMAINS) : [];
  memory.workflows = Array.isArray(parsed.workflows) ? parsed.workflows.slice(0, MAX_MEMORY_WORKFLOWS) : [];
  memory.checkpoints = Array.isArray(parsed.checkpoints) ? parsed.checkpoints.slice(0, MAX_MEMORY_CHECKPOINTS) : [];
  return memory;
}

function persistSettings() {
  localStorage.setItem("desktopSettings", JSON.stringify(state.settings));
  syncMemoryPreferencesFromSettings();
  persistAgentMemory();
  updatePolicyGuidance(state.settings.trustedOrigins);
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

function persistAgentMemory() {
  localStorage.setItem(AGENT_MEMORY_KEY, JSON.stringify(state.memory));
}

function loadTelemetry() {
  try {
    const raw = localStorage.getItem(TELEMETRY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeTelemetry(parsed);
  } catch {
    return createEmptyTelemetry();
  }
}

function createEmptyTelemetry() {
  return {
    version: 1,
    summary: {
      taskRuns: 0,
      taskSuccesses: 0,
      taskBlocked: 0,
      stepAttempts: 0,
      stepSuccesses: 0,
      approvalsRequested: 0,
      approvalsGranted: 0,
      approvalsDenied: 0,
      recoveryAttempts: 0,
      recoverySuccesses: 0,
      toolCalls: 0
    },
    failureCategories: {},
    recentEvents: [],
    lastFailure: "",
    activeRun: null
  };
}

function normalizeTelemetry(parsed) {
  const telemetry = createEmptyTelemetry();
  if (!parsed || typeof parsed !== "object") {
    return telemetry;
  }

  telemetry.summary = {
    ...telemetry.summary,
    ...(parsed.summary && typeof parsed.summary === "object" ? parsed.summary : {})
  };
  telemetry.failureCategories = parsed.failureCategories && typeof parsed.failureCategories === "object"
    ? parsed.failureCategories
    : {};
  telemetry.recentEvents = Array.isArray(parsed.recentEvents) ? parsed.recentEvents.slice(0, TELEMETRY_EVENT_LIMIT) : [];
  telemetry.lastFailure = typeof parsed.lastFailure === "string" ? parsed.lastFailure : "";
  telemetry.activeRun = parsed.activeRun && typeof parsed.activeRun === "object" ? parsed.activeRun : null;
  return telemetry;
}

function persistTelemetry() {
  localStorage.setItem(TELEMETRY_KEY, JSON.stringify(state.telemetry));
}

function syncMemoryPreferencesFromSettings() {
  state.memory.userPreferences.assistant = {
    preferredModel: state.settings.model,
    preferredModelCapability: modelSupportsVision(state.settings.model) ? "vision" : "not-preferred",
    approvalMode: state.settings.approvalMode || DEFAULT_SETTINGS.approvalMode,
    temperature: state.settings.temperature,
    maxIterations: state.settings.maxIterations,
    maxIterationsAuto: state.settings.maxIterationsAuto !== false,
    trustedOrigins: parseTrustedOrigins(state.settings.trustedOrigins),
    updatedAt: new Date().toISOString()
  };
}

function announceResumableMemory() {
  const activeGoal = state.memory.activeGoal;
  if (!activeGoal || !["running", "blocked"].includes(activeGoal.status)) {
    return;
  }

  const checkpoint = state.memory.checkpoints.find((entry) => entry.taskId === activeGoal.taskId) || null;
  const stepCopy = checkpoint?.currentStepObjective || activeGoal.currentStepObjective || "the next step";
  state.lastResult = `Resumable task available: ${truncate(activeGoal.task || "Previous task", 120)}. Last checkpoint: ${truncate(stepCopy, 120)}.`;
  pushLog("info", `Resumable checkpoint restored for "${truncate(activeGoal.task || "previous task", 100)}".`);
}

function recordRecentDomainVisit(url, title) {
  const domain = extractMemoryDomain(url);
  if (!domain) {
    return;
  }

  const now = new Date().toISOString();
  const existing = state.memory.recentDomains.find((entry) => entry.domain === domain);
  if (existing) {
    existing.visits = (existing.visits || 0) + 1;
    existing.lastVisitedAt = now;
    existing.titleHint = truncate(title || existing.titleHint || "", 80);
  } else {
    state.memory.recentDomains.unshift({
      domain,
      visits: 1,
      lastVisitedAt: now,
      titleHint: truncate(title || "", 80)
    });
  }

  state.memory.recentDomains.sort((left, right) => {
    if ((right.lastVisitedAt || "") !== (left.lastVisitedAt || "")) {
      return String(right.lastVisitedAt || "").localeCompare(String(left.lastVisitedAt || ""));
    }
    return (right.visits || 0) - (left.visits || 0);
  });
  state.memory.recentDomains = state.memory.recentDomains.slice(0, MAX_MEMORY_DOMAINS);
  persistAgentMemory();
}

function applyLayoutState() {
  elements.windowShell.classList.toggle("agent-collapsed", state.preferences.agentPaneOpen === false);
  elements.windowShell.classList.toggle("settings-panel-open", state.preferences.settingsPanelOpen === true);
  elements.toggleAgentButton.textContent = state.preferences.agentPaneOpen ? "Hide assistant" : "Show assistant";
  elements.toggleAgentButton.setAttribute("aria-pressed", state.preferences.agentPaneOpen ? "true" : "false");
  elements.assistantSettingsButton.setAttribute("aria-expanded", state.preferences.settingsPanelOpen ? "true" : "false");
  elements.assistantSettingsPanel.hidden = state.preferences.settingsPanelOpen !== true;
  elements.assistantSettingsPanel.setAttribute("aria-hidden", state.preferences.settingsPanelOpen ? "false" : "true");
  window.requestAnimationFrame(updateAgentScrollButtons);
}

function updateIterationsModeUi() {
  const auto = state.settings.maxIterationsAuto !== false;
  elements.iterationsAutoButton.textContent = auto ? "Auto on" : "Auto off";
  elements.iterationsAutoButton.setAttribute("aria-pressed", auto ? "true" : "false");
  elements.iterationsInput.disabled = auto;
  elements.iterationsGuidance.textContent = auto
    ? "The assistant will choose a step budget for each task."
    : "Use the number field to set the maximum step budget yourself.";
}

function resolveIterationBudget(task) {
  if (state.settings.maxIterationsAuto === false) {
    return clampInteger(state.settings.maxIterations, 2, 30, DEFAULT_SETTINGS.maxIterations);
  }

  const normalized = String(task || "").toLowerCase();
  let budget = 8;
  if (normalized.split(/\s+/).filter(Boolean).length >= 8) {
    budget += 2;
  }
  if (/\b(and|then|after|before|compare|monitor|sign in|log in|fill|submit|checkout|search|research)\b/.test(normalized)) {
    budget += 2;
  }
  if (/\b(click|type|enter|open|go to|navigate|summari[sz]e|explain|inspect)\b/.test(normalized)) {
    budget += 1;
  }

  return clampInteger(budget, 6, 20, DEFAULT_SETTINGS.maxIterations);
}

function toggleSettingsPanel(force) {
  if (state.preferences.agentPaneOpen === false) {
    state.preferences.agentPaneOpen = true;
  }

  state.preferences.settingsPanelOpen = typeof force === "boolean"
    ? force
    : !state.preferences.settingsPanelOpen;
  persistPreferences();
  applyLayoutState();
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
  const paneOpen = state.preferences.agentPaneOpen !== false && state.preferences.settingsPanelOpen !== true;

  elements.agentScrollUpButton.disabled = !paneOpen || atTop;
  elements.agentScrollDownButton.disabled = !paneOpen || atBottom;
}

async function refreshModels({ silent }) {
  state.settings = readSettingsForm();
  persistSettings();

  try {
    const models = await window.desktopBridge.listModels(state.settings);
    state.modelCatalog = normalizeModelCatalog(models, state.settings.model);
    populateModelOptions(state.modelCatalog, state.settings.model);
    if (!silent) {
      const recommendation = recommendModel(state.modelCatalog);
      const suffix = recommendation
        ? ` Recommended: ${recommendation.name} (${recommendation.capabilityLabel.toLowerCase()}).`
        : " No vision model detected yet.";
      setFeedback(`Found ${models.length} local model${models.length === 1 ? "" : "s"}.${suffix}`, "success");
    }
  } catch (error) {
    state.modelCatalog = normalizeModelCatalog([{ name: state.settings.model }], state.settings.model);
    populateModelOptions(state.modelCatalog, state.settings.model);
    if (!silent) {
      setFeedback(formatAppError(error), "error");
    }
  }
}

async function testConnection() {
  state.settings = readSettingsForm();
  persistSettings();
  setFeedback("Checking Ollama connection...", "");
  try {
    const result = await window.desktopBridge.testConnection(state.settings);
    state.modelCatalog = normalizeModelCatalog(result.models, state.settings.model);
    populateModelOptions(state.modelCatalog, state.settings.model);
    const recommendation = recommendModel(state.modelCatalog);
    const suffix = recommendation
      ? ` Recommended: ${recommendation.name} (${recommendation.capabilityLabel.toLowerCase()}).`
      : " No vision model detected yet.";
    setFeedback(`Connection ok. ${result.modelCount} model${result.modelCount === 1 ? "" : "s"} available.${suffix}`, "success");
  } catch (error) {
    setFeedback(formatAppError(error), "error");
  }
}

function populateModelOptions(models, selectedModel) {
  const entries = normalizeModelCatalog(models, selectedModel);
  state.modelCatalog = entries;

  elements.modelSelect.textContent = "";
  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = entry.name;
    option.textContent = `${entry.name} (${entry.capabilityLabel})`;
    option.selected = entry.name === selectedModel;
    elements.modelSelect.append(option);
  }

  updateModelGuidance(entries, selectedModel || entries[0]?.name || "");
}

function normalizeModelCatalog(models, selectedModel) {
  const rawEntries = Array.isArray(models) ? models : [];
  const names = rawEntries.map((model) => typeof model === "string" ? model : model.name).filter(Boolean);
  if (selectedModel && !names.includes(selectedModel)) {
    names.unshift(selectedModel);
  }

  return names
    .map((name) => {
      const capability = modelSupportsVision(name) ? "vision" : "not-preferred";
      return {
        name,
        capability,
        capabilityLabel: capability === "vision" ? "Vision" : "Not preferred",
        recommendationScore: getModelRecommendationScore(name, capability)
      };
    })
    .sort((left, right) => {
      if (right.recommendationScore !== left.recommendationScore) {
        return right.recommendationScore - left.recommendationScore;
      }
      return left.name.localeCompare(right.name);
    });
}

function updateModelGuidance(entries, selectedModel) {
  const catalog = Array.isArray(entries) ? entries : [];
  const selectedEntry = catalog.find((entry) => entry.name === selectedModel) || catalog[0] || null;
  const recommendation = recommendModel(catalog);

  if (!selectedEntry) {
    elements.modelGuidance.textContent = "Refresh models to detect whether a vision-capable model is available.";
    elements.modelGuidance.className = "model-guidance not-preferred";
    return;
  }

  if (selectedEntry.capability === "vision") {
    const suffix = recommendation && recommendation.name !== selectedEntry.name
      ? ` Another strong option is ${recommendation.name}.`
      : " This model can use screenshot grounding directly.";
    elements.modelGuidance.textContent = `${selectedEntry.name} is a vision model and is preferred for this browser.${suffix}`;
    elements.modelGuidance.className = "model-guidance vision";
    return;
  }

  if (recommendation) {
    elements.modelGuidance.textContent = `${selectedEntry.name} is not preferred because it cannot use screenshot grounding directly. Recommended: ${recommendation.name} (Vision).`;
    elements.modelGuidance.className = "model-guidance not-preferred";
    return;
  }

  elements.modelGuidance.textContent = `${selectedEntry.name} is not preferred for browser perception. Install or pull a vision-capable Ollama model for screenshot grounding.`;
  elements.modelGuidance.className = "model-guidance not-preferred";
}

function recommendModel(entries) {
  const catalog = Array.isArray(entries) ? entries : [];
  return catalog.find((entry) => entry.capability === "vision") || null;
}

function getModelRecommendationScore(name, capability) {
  if (capability !== "vision") {
    return 0;
  }

  const normalized = String(name || "").toLowerCase();
  if (normalized.includes("qwen2.5-vl")) {
    return 120;
  }
  if (normalized.includes("qwen2-vl")) {
    return 115;
  }
  if (normalized.includes("gemma3")) {
    return 110;
  }
  if (normalized.includes("pixtral")) {
    return 108;
  }
  if (normalized.includes("llava")) {
    return 105;
  }
  if (normalized.includes("internvl") || normalized.includes("cogvlm") || normalized.includes("llama3.2-vision")) {
    return 102;
  }
  if (normalized.includes("bakllava")) {
    return 100;
  }
  if (normalized.includes("moondream")) {
    return 95;
  }
  if (normalized.includes("vision")) {
    return 90;
  }
  return 80;
}

function setFeedback(message, tone) {
  elements.settingsFeedback.textContent = message;
  elements.settingsFeedback.className = `feedback${tone ? ` ${tone}` : ""}`;
}

function formatAppError(error) {
  const message = String(error?.message || error || "Unknown error").trim();
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
}

function syncAddressBar() {
  const tab = getActiveTab();
  elements.addressInput.value = formatDisplayUrl(tab?.url || "");
  updateAddressMeta(elements.addressInput.value);
}

function updateBrowserContext() {
  const tab = getActiveTab();
  if (!tab) {
    elements.activePageLabel.textContent = "No page loaded yet.";
    elements.pageBadge.textContent = "No tab";
    elements.pageBadge.className = "page-badge";
    elements.pageProgress.classList.remove("active");
    document.title = "Electron";
    return;
  }

  const displayUrl = formatDisplayUrl(tab.url || "");
  elements.activePageLabel.textContent = tab.loading
    ? `Loading ${displayUrl || tab.title || "page"}...`
    : `${tab.title || "Untitled"} · ${displayUrl}`;
  elements.pageBadge.textContent = formatPageBadge(tab.url, tab.loading);
  elements.pageBadge.className = `page-badge ${classifyPageBadge(tab.url)}${tab.loading ? " loading" : ""}`;
  elements.pageProgress.classList.toggle("active", tab.loading);
  document.title = tab.loading
    ? `Loading ${tab.title || displayUrl || "page"}`
    : `${tab.title || "Electron"}${displayUrl ? ` - ${displayUrl}` : ""}`;

  elements.backButton.disabled = !(tab.domReady && tab.webview?.canGoBack?.());
  elements.forwardButton.disabled = !(tab.domReady && tab.webview?.canGoForward?.());
  updateAddressMeta(elements.addressInput.value);
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
    return {
      ok: false,
      error: "No active tab selected.",
      failureCategory: "navigation"
    };
  }
  await waitForWebviewDomReady(tab.webview);
  tab.webview.reload();
  await waitForLoad(tab.webview);
  return {
    ok: true,
    currentTabId: tab.id,
    tab: serializeTab(tab),
    summary: `Reloaded ${tab.title || "the current tab"}.`
  };
}

async function goBack() {
  const tab = getActiveTab();
  if (!tab) {
    return {
      ok: false,
      error: "No active tab selected.",
      failureCategory: "navigation"
    };
  }
  if (!tab.domReady || !tab.webview?.canGoBack()) {
    return {
      ok: false,
      error: "The current tab cannot go back.",
      failureCategory: "no_state_change"
    };
  }
  tab.webview.goBack();
  await waitForLoad(tab.webview, 10000, true);
  return {
    ok: true,
    currentTabId: tab.id,
    tab: serializeTab(tab),
    summary: `Moved back in ${tab.title || "the current tab"}.`
  };
}

async function goForward() {
  const tab = getActiveTab();
  if (!tab) {
    return {
      ok: false,
      error: "No active tab selected.",
      failureCategory: "navigation"
    };
  }
  if (!tab.domReady || !tab.webview?.canGoForward()) {
    return {
      ok: false,
      error: "The current tab cannot go forward.",
      failureCategory: "no_state_change"
    };
  }
  tab.webview.goForward();
  await waitForLoad(tab.webview, 10000, true);
  return {
    ok: true,
    currentTabId: tab.id,
    tab: serializeTab(tab),
    summary: `Moved forward in ${tab.title || "the current tab"}.`
  };
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

  const directConversationReply = buildDirectConversationReply(task);
  if (directConversationReply) {
    appendConversation("user", task);
    elements.taskInput.value = "";
    state.currentTask = task;
    state.lastResult = directConversationReply;
    appendConversation("assistant", directConversationReply);
    pushLog("assistant", directConversationReply);
    renderState();
    return;
  }

  if (!getActiveTab()) {
    pushLog("error", "No active tab is available.");
    return;
  }

  state.settings = readSettingsForm();
  persistSettings();
  const maxTurns = resolveIterationBudget(task);
  state.running = true;
  state.abortRequested = false;
  state.currentTask = task;
  state.lastResult = "Working through the current task.";
  state.currentStep = { step: 0, total: maxTurns, label: "starting" };
  appendConversation("user", task);
  elements.taskInput.value = "";
  renderState();

  pushLog("info", `Queued message: ${task}`);
  const taskId = beginGoalMemory(task);
  recordTaskTelemetryStart(taskId, task);
  const budget = {
    used: 0,
    total: maxTurns
  };

  try {
    const initialObservation = await observeCurrentPage({
      includeText: true,
      includeMetadata: true,
      includeScreenshot: false,
      includeOcr: false,
      includeDiff: true
    });

    const plan = await createExecutionPlan({
      task,
      initialObservation,
      budget
    });

    applyPlanToGoalMemory(taskId, plan, initialObservation);
    updateTaskTelemetryPlan(taskId, plan);

    pushLog("reasoning", `Plan ready: ${formatExecutionPlan(plan)}`);

    const completedSteps = [];
    for (let index = 0; index < plan.steps.length; index += 1) {
      ensureNotCancelled();
      const step = plan.steps[index];
      const outcome = await executePlannedStep({
        task,
        taskId,
        plan,
        step,
        stepIndex: index,
        completedSteps,
        budget
      });

      completedSteps.push(outcome);
      updateGoalMemoryFromOutcome(taskId, plan, completedSteps);

      if (outcome.verification?.verdict !== "complete") {
        break;
      }
    }

    const finalAnswer = await finalizeTaskRun({
      task,
      plan,
      completedSteps,
      budget
    });

    const runStatus = completedSteps.some((entry) => entry.verification?.verdict !== "complete") ? "blocked" : "completed";
    completeGoalMemory(taskId, plan, completedSteps, runStatus, finalAnswer);
    recordTaskTelemetryFinish(taskId, runStatus, completedSteps, runStatus === "completed" ? "" : finalAnswer);
    state.lastResult = finalAnswer;
    appendConversation("assistant", finalAnswer);
    pushLog("success", finalAnswer);
    renderState();
  } catch (error) {
    const userFacingError = formatAppError(error);
    failGoalMemory(taskId, error);
    recordTaskTelemetryFinish(taskId, "blocked", [], userFacingError);
    state.lastResult = userFacingError;
    appendConversation("assistant", `I ran into an error while working on that: ${userFacingError}`);
    pushLog("error", userFacingError);
  } finally {
    state.running = false;
    state.abortRequested = false;
    state.currentStep = null;
    renderState();
  }
}

async function createExecutionPlan({ task, initialObservation, budget }) {
  const memoryContext = buildRelevantMemoryContext(task);
  const workflowContext = buildWorkflowContext(task, initialObservation?.page, memoryContext);
  const plannerMessages = [
    { role: "system", content: PLANNER_SYSTEM_PROMPT },
    ...buildConversationHistoryMessages(),
    {
      role: "user",
      content: [
        `User request: ${task}`,
        "",
        "Relevant memory:",
        formatMemoryContext(memoryContext),
        "",
        "Workflow library:",
        formatWorkflowContext(workflowContext),
        "",
        "Current page observation:",
        formatObservationForPrompt(initialObservation.page, { includeVisibleText: true }),
        "",
        "Return JSON only."
      ].join("\n")
    }
  ];

  const assistantMessage = await requestModelTurn({
    label: "planner",
    messages: plannerMessages,
    tools: [],
    budget
  });

  const parsedPlan = parseJsonResponse(assistantMessage.content);
  return normalizeExecutionPlan(parsedPlan, task, workflowContext);
}

async function executePlannedStep({ task, taskId, plan, step, stepIndex, completedSteps, budget }) {
  let verifierFeedback = "";
  let latestObservation = null;
  const recentToolSummaries = [];
  let lastToolExecution = null;

  for (let attempt = 1; attempt <= MAX_STEP_RETRIES; attempt += 1) {
    ensureNotCancelled();
    pushLog("info", `Executing step ${stepIndex + 1}/${plan.steps.length}: ${step.objective}`);
    recordStepTelemetryAttempt(taskId, step, attempt);

    const executorMessages = [
      { role: "system", content: EXECUTOR_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildExecutorPrompt({
          task,
          taskId,
          plan,
          step,
          stepIndex,
          completedSteps,
          verifierFeedback,
          latestObservation
        })
      }
    ];

    let executorSummary = "";
    recentToolSummaries.length = 0;
    lastToolExecution = null;

    for (let turn = 1; turn <= MAX_EXECUTOR_TURNS_PER_ATTEMPT; turn += 1) {
      ensureNotCancelled();
      const assistantMessage = await requestModelTurn({
        label: `execute ${stepIndex + 1}.${turn}`,
        messages: executorMessages,
        tools: TOOL_DEFINITIONS,
        budget
      });

      executorMessages.push(assistantMessage);

      const reasoningSummary = buildReasoningSummary(assistantMessage);
      if (reasoningSummary) {
        pushLog("reasoning", reasoningSummary);
      }

      if (assistantMessage.content) {
        pushLog("assistant", assistantMessage.content);
      }

      const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];
      if (!toolCalls.length) {
        executorSummary = assistantMessage.content || `Completed step: ${step.objective}`;
        break;
      }

      for (const toolCall of toolCalls) {
        const toolResult = await executeToolCallFromModel({
          toolCall,
          stepIndex,
          taskId,
          budget
        });

        lastToolExecution = toolResult;
        recentToolSummaries.push(summarizeToolResult(toolCall?.function?.name || "tool", toolResult.transcriptResult));
        executorMessages.push({
          role: "tool",
          tool_name: toolResult.name,
          content: JSON.stringify(toolResult.transcriptResult)
        });

        if (toolResult.visualGroundingMessage) {
          executorMessages.push(toolResult.visualGroundingMessage);
        }
      }
    }

    latestObservation = await observeCurrentPage({
      includeText: false,
      includeMetadata: true,
      includeScreenshot: false,
      includeOcr: false,
      includeDiff: true
    });

    const verification = await verifyExecutionStep({
      task,
      plan,
      step,
      stepIndex,
      completedSteps,
      executorSummary,
      recentToolSummaries,
      observation: latestObservation,
      budget
    });

    if (verification.verdict === "complete") {
      recordStepTelemetryVerification(taskId, step, verification, "complete");
      pushLog("success", `Verified step ${stepIndex + 1}: ${verification.reason}`);
      return {
        stepId: step.id,
        objective: step.objective,
        successCriteria: step.successCriteria,
        executorSummary,
        verification,
        attemptCount: attempt,
        observationSummary: latestObservation?.pageStateDiff?.summary || ""
      };
    }

    const failureCategory = categorizeExecutionFailure({
      verification,
      lastToolExecution,
      observation: latestObservation
    });
    recordStepTelemetryVerification(taskId, step, verification, failureCategory);

    const recovery = await attemptAutomaticRecovery({
      taskId,
      step,
      verification,
      failureCategory,
      lastToolExecution,
      observation: latestObservation,
      budget
    });

    if (recovery.blocked) {
      pushLog("warn", `Step ${stepIndex + 1} blocked: ${recovery.note}`);
      return {
        stepId: step.id,
        objective: step.objective,
        successCriteria: step.successCriteria,
        executorSummary,
        verification: {
          verdict: "blocked",
          reason: recovery.note,
          evidence: verification.evidence || "",
          nextActionHint: recovery.nextActionHint || verification.nextActionHint || ""
        },
        attemptCount: attempt,
        observationSummary: latestObservation?.pageStateDiff?.summary || ""
      };
    }

    if (verification.verdict === "blocked") {
      pushLog("warn", `Step ${stepIndex + 1} blocked: ${verification.reason}`);
      return {
        stepId: step.id,
        objective: step.objective,
        successCriteria: step.successCriteria,
        executorSummary,
        verification,
        attemptCount: attempt,
        observationSummary: latestObservation?.pageStateDiff?.summary || ""
      };
    }

    verifierFeedback = [
      `Verifier reason: ${verification.reason}`,
      verification.evidence ? `Evidence: ${verification.evidence}` : "",
      verification.nextActionHint ? `Next action hint: ${verification.nextActionHint}` : "",
      recovery.note ? `Recovery note: ${recovery.note}` : ""
    ].filter(Boolean).join("\n");
    pushLog("warn", `Retrying step ${stepIndex + 1}: ${verification.reason}`);
  }

  return {
    stepId: step.id,
    objective: step.objective,
    successCriteria: step.successCriteria,
    executorSummary: "The step did not verify successfully within the retry limit.",
    verification: {
      verdict: "blocked",
      reason: "The step could not be verified after multiple attempts.",
      evidence: "",
      nextActionHint: "Re-inspect the page and revise the plan."
    },
    attemptCount: MAX_STEP_RETRIES
  };
}

async function verifyExecutionStep({ task, plan, step, stepIndex, completedSteps, executorSummary, recentToolSummaries, observation, budget }) {
  const verifierMessages = [
    { role: "system", content: VERIFIER_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `User request: ${task}`,
        `Plan summary: ${plan.summary}`,
        `Current step (${stepIndex + 1}/${plan.steps.length}): ${step.objective}`,
        `Success criteria: ${step.successCriteria}`,
        completedSteps.length
          ? `Completed steps so far: ${completedSteps.map((entry) => entry.objective).join(" | ")}`
          : "Completed steps so far: none",
        `Executor summary: ${executorSummary || "No executor summary provided."}`,
        recentToolSummaries.length
          ? `Recent tool results:\n- ${recentToolSummaries.join("\n- ")}`
          : "Recent tool results: none",
        "Latest page observation:",
        formatObservationForPrompt(observation.page, { includeVisibleText: false }),
        observation.pageStateDiff?.summary ? `Latest page diff: ${observation.pageStateDiff.summary}` : "",
        "",
        "Return JSON only."
      ].filter(Boolean).join("\n")
    }
  ];

  const assistantMessage = await requestModelTurn({
    label: `verify ${stepIndex + 1}`,
    messages: verifierMessages,
    tools: [],
    budget
  });

  return normalizeVerificationResult(parseJsonResponse(assistantMessage.content), observation);
}

async function finalizeTaskRun({ task, plan, completedSteps, budget }) {
  const memoryContext = buildRelevantMemoryContext(task);
  const blockedStep = completedSteps.find((entry) => entry.verification?.verdict !== "complete") || null;
  const finalizerMessages = [
    { role: "system", content: FINALIZER_SYSTEM_PROMPT },
    ...buildConversationHistoryMessages(),
    {
      role: "user",
      content: [
        `Original user request: ${task}`,
        "Relevant memory:",
        formatMemoryContext(memoryContext),
        `Plan summary: ${plan.summary}`,
        "Execution results:",
        completedSteps.map((entry, index) => formatStepOutcome(entry, index)).join("\n"),
        blockedStep
          ? `The run stopped early because step "${blockedStep.objective}" was ${blockedStep.verification.verdict}.`
          : "All planned steps were verified.",
        "",
        "Write the final assistant reply for the user."
      ].join("\n")
    }
  ];

  try {
    const assistantMessage = await requestModelTurn({
      label: "finalize",
      messages: finalizerMessages,
      tools: [],
      budget
    });
    return assistantMessage.content || buildLocalFinalSummary(task, completedSteps);
  } catch {
    return buildLocalFinalSummary(task, completedSteps);
  }
}

async function executeToolCallFromModel({ toolCall, stepIndex, taskId, budget }) {
  ensureNotCancelled();
  const name = toolCall?.function?.name;
  const args = normalizeArguments(toolCall?.function?.arguments);
  if (!name) {
    return {
      name: "unknown_tool",
      transcriptResult: { ok: false, error: "Tool call missing function name." },
      visualGroundingMessage: null
    };
  }

  const invalidArgumentsResult = validateToolArguments(name, args);
  if (invalidArgumentsResult) {
    recordToolTelemetry(name, invalidArgumentsResult);
    pushLog("error", summarizeToolResult(name, invalidArgumentsResult));
    return {
      name,
      transcriptResult: invalidArgumentsResult,
      visualGroundingMessage: null
    };
  }

  const policyDecision = await evaluateSafetyPolicy(name, args);
  if (policyDecision.blocked) {
    const blockedResult = { ok: false, error: policyDecision.reason, failureCategory: "policy_blocked" };
    state.telemetry.failureCategories.policy_blocked = (state.telemetry.failureCategories.policy_blocked || 0) + 1;
    state.telemetry.lastFailure = truncate(policyDecision.reason, 180);
    pushTelemetryEvent("policy", policyDecision.reason);
    persistTelemetry();
    pushLog("warn", policyDecision.reason);
    return {
      name,
      transcriptResult: blockedResult,
      visualGroundingMessage: null,
      policyDecision
    };
  }

  if (policyDecision.requiresApproval || (state.settings.approvalMode === "manual" && MUTATING_TOOLS.has(name))) {
    recordApprovalTelemetry(null, policyDecision.reason || `Approval requested for ${name}.`);
    const approved = window.confirm(`Approve browser action?\n\n${policyDecision.reason || describeToolUse(name, args)}`);
    if (!approved) {
      const deniedResult = { ok: false, error: "Action denied by user.", failureCategory: "approval_denied" };
      recordApprovalTelemetry(false, policyDecision.reason || `Denied ${name}.`);
      pushLog("warn", `Denied ${name}.`);
      return {
        name,
        transcriptResult: deniedResult,
        visualGroundingMessage: null,
        policyDecision
      };
    }
    recordApprovalTelemetry(true, policyDecision.reason || `Approved ${name}.`);
  }

  state.currentStep = {
    step: budget.used,
    total: budget.total,
    label: `${name} (step ${stepIndex + 1})`
  };
  renderState();
  pushLog("tool", `Tool: ${name}`);

  let result;
  try {
    result = await executeTool(name, args);
  } catch (error) {
    result = { ok: false, error: error.message };
  }

  const transcriptResult = serializeToolResult(result);
  recordToolTelemetry(name, transcriptResult);
  pushLog(transcriptResult.ok === false ? "error" : "tool", summarizeToolResult(name, transcriptResult));

  return {
    name,
    transcriptResult,
    visualGroundingMessage: buildVisualGroundingMessage(state.settings.model, name, result),
    policyDecision
  };
}

async function requestModelTurn({ label, messages, tools, budget }) {
  ensureNotCancelled();
  if (budget.used >= budget.total) {
    throw new Error(`Stopped after ${budget.total} model turns without finishing the task.`);
  }

  budget.used += 1;
  state.currentStep = { step: budget.used, total: budget.total, label };
  renderState();
  pushLog("info", `Model turn ${budget.used}/${budget.total}: ${label}`);

  const response = await window.desktopBridge.chatWithOllama({
    settings: state.settings,
    messages,
    tools: Array.isArray(tools) ? tools : []
  });

  return normalizeAssistantMessage(response.message);
}

async function executeTool(name, args) {
  await ensurePageObservationBaseline(name);
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
      return withPageStateDiff("switch_to_tab", await switchToTab(args));
    case "open_new_tab": {
      const openedTabResult = await openNewTab(args);
      return withPageStateDiff("open_new_tab", openedTabResult, {
        tabId: openedTabResult.openedTabId || openedTabResult.currentTabId
      });
    }
    case "open_or_search":
      return withPageStateDiff("open_or_search", await openOrSearch(args));
    case "navigate_to":
      return withPageStateDiff("navigate_to", await navigateTo(args));
    case "reload_tab":
      return withPageStateDiff("reload_tab", await reloadActiveTab());
    case "go_back":
      return withPageStateDiff("go_back", await goBack());
    case "go_forward":
      return withPageStateDiff("go_forward", await goForward());
    case "close_current_tab":
      return withPageStateDiff("close_current_tab", await closeCurrentTab());
    case "inspect_page":
      return inspectPage(args);
    case "click_element":
      return withPageStateDiff("click_element", await runPageCommand("clickElement", {
        elementId: args.elementId,
        elementHint: args.elementHint || ""
      }));
    case "type_into_element":
      return withPageStateDiff("type_into_element", await runPageCommand("typeIntoElement", {
        elementId: args.elementId,
        elementHint: args.elementHint || "",
        text: String(args.text || ""),
        clearFirst: args.clearFirst !== false,
        submit: args.submit === true
      }));
    case "hover_element":
      return withPageStateDiff("hover_element", await runPageCommand("hoverElement", {
        elementId: args.elementId,
        elementHint: args.elementHint || ""
      }));
    case "move_mouse_to_element":
      return runPageCommand("moveMouseToElement", {
        elementId: args.elementId,
        elementHint: args.elementHint || ""
      });
    case "move_mouse_to_coordinates":
      return runPageCommand("moveMouseToCoordinates", {
        x: args.x,
        y: args.y,
        label: args.label || ""
      });
    case "scroll_page":
      return withPageStateDiff("scroll_page", await runPageCommand("scrollPage", {
        direction: args.direction === "up" ? "up" : "down",
        amount: normalizeAmount(args.amount)
      }));
    case "read_element_text":
      return runPageCommand("readElementText", {
        elementId: args.elementId,
        elementHint: args.elementHint || ""
      });
    case "wait":
      await sleep(clampInteger(args.milliseconds, 100, 10000, 1000));
      return { ok: true, summary: `Waited ${clampInteger(args.milliseconds, 100, 10000, 1000)} ms.` };
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

async function switchToTab(args) {
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
  await ensureTabIsLoaded(tab);
  await waitForDomReady(tab.webview);
  return {
    ok: true,
    currentTabId: tab.id,
    tab: serializeTab(tab),
    summary: `Switched to "${tab.title || tab.url || "Untitled"}".`
  };
}

async function openNewTab(args) {
  const nextTab = createTab(args.url || START_PAGE_URL);
  if (args.active === false) {
    const previous = state.tabs.find((tab) => tab.id !== nextTab.id);
    if (previous) {
      selectTab(previous.id);
    }
  }
  await waitForDomReady(nextTab.webview);

  return {
    ok: true,
    currentTabId: getActiveTab()?.id || nextTab.id,
    openedTabId: nextTab.id,
    tab: serializeTab(nextTab),
    summary: args.url ? `Opened a new tab at ${normalizeDestination(args.url)}.` : "Opened a new tab."
  };
}

async function openOrSearch(args) {
  if (!String(args.query || "").trim()) {
    return {
      ok: false,
      error: "open_or_search requires a query or destination.",
      failureCategory: "invalid_arguments"
    };
  }
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
  const observation = await observeCurrentPage({
    includeText: args.includeText !== false,
    includeMetadata: args.includeMetadata !== false,
    includeScreenshot: args.includeScreenshot !== false,
    includeOcr: args.includeOcr !== false,
    includeDiff: args.includeDiff !== false
  });

  const page = observation.page;
  return {
    ok: true,
    currentTabId: getActiveTab()?.id || null,
    page,
    pageStateDiff: observation.pageStateDiff,
    visualContext: observation.visualContext,
    summary: `Inspected ${getActiveTab()?.title || getActiveTab()?.url || "page"}. Found ${page.interactiveElements?.length || 0} ranked interactive elements, ${page.landmarks?.length || 0} landmarks, and ${page.forms?.length || 0} forms.`
  };
}

async function withPageStateDiff(toolName, result, options = {}) {
  if (result?.ok === false || !TOOLS_WITH_PAGE_STATE_DIFF.has(toolName)) {
    return result;
  }

  const targetTab = options.tabId
    ? state.tabs.find((tab) => tab.id === options.tabId) || null
    : result?.currentTabId
      ? state.tabs.find((tab) => tab.id === result.currentTabId) || getActiveTab()
      : getActiveTab();
  const observation = await observePageForTab(targetTab, {
    includeText: false,
    includeMetadata: true,
    includeScreenshot: false,
    includeOcr: false,
    includeDiff: true
  });

  return {
    ...result,
    observedTabId: targetTab?.id || null,
    pageState: buildCompactPageState(observation.page),
    pageStateDiff: observation.pageStateDiff,
    summary: mergeSummaries(result.summary, observation.pageStateDiff?.summary)
  };
}

async function observeCurrentPage(options = {}) {
  return observePageForTab(getActiveTab(), options);
}

async function observePageForTab(tab, options = {}) {
  if (!tab?.webview) {
    throw new Error("No active browser tab is available.");
  }

  const page = await runPageCommandForTab(tab, "snapshot", {
    includeText: options.includeText !== false,
    includeMetadata: options.includeMetadata !== false
  });

  let visualContext = null;
  if (options.includeScreenshot !== false) {
    visualContext = await buildVisualGrounding(tab, {
    includeOcr: options.includeOcr !== false
    });
    if (visualContext) {
      page.visualGrounding = {
        ok: true,
        screenshot: visualContext.screenshot,
        ocr: visualContext.ocr,
        summary: visualContext.summary
      };
    } else {
      page.visualGrounding = {
        ok: false,
        screenshot: null,
        ocr: null,
        summary: "Screenshot grounding was unavailable for this observation."
      };
    }
  }

  const previousPage = tab.lastObservedPage;
  const pageStateDiff = options.includeDiff === false ? null : buildPageStateDiff(previousPage, page);
  tab.lastObservedPage = cloneObservedPage(page);

  return {
    page,
    pageStateDiff,
    visualContext
  };
}

async function runPageCommand(type, payload) {
  return runPageCommandForTab(getActiveTab(), type, payload);
}

async function runPageCommandForTab(tab, type, payload) {
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

async function ensurePageObservationBaseline(toolName) {
  const tab = getActiveTab();
  if (!tab?.webview || !TOOL_BASELINE_REQUIRED.has(toolName) || tab.lastObservedPage) {
    return;
  }

  try {
    await observePageForTab(tab, {
      includeText: false,
      includeMetadata: true,
      includeScreenshot: false,
      includeOcr: false,
      includeDiff: false
    });
  } catch (error) {
    pushLog("warn", `Unable to capture a pre-action page baseline: ${error.message}`);
  }
}

async function buildVisualGrounding(tab, { includeOcr }) {
  const screenshot = await captureScreenshot(tab);
  if (!screenshot) {
    return null;
  }

  let ocr = null;
  if (includeOcr) {
    try {
      ocr = await window.desktopBridge.ocrScreenshot({
        imageBase64: screenshot.imageBase64,
        maxCharacters: 2200
      });
    } catch (error) {
      ocr = {
        ok: false,
        error: error.message
      };
    }
  }

  return {
    ok: true,
    imageBase64: screenshot.imageBase64,
    screenshot: {
      width: screenshot.width,
      height: screenshot.height,
      byteLength: screenshot.byteLength,
      fingerprint: screenshot.fingerprint
    },
    ocr,
    summary: ocr?.ok
      ? `Captured a ${screenshot.width}x${screenshot.height} screenshot and extracted ${ocr.wordCount} OCR words.`
      : `Captured a ${screenshot.width}x${screenshot.height} screenshot for visual grounding.`
  };
}

async function captureScreenshot(tab) {
  await waitForDomReady(tab.webview);
  const image = await tab.webview.capturePage();
  const resized = image.resize({
    width: Math.min(1280, image.getSize().width || 1280)
  });
  const pngBuffer = resized.toPNG();
  const size = resized.getSize();

  return {
    width: size.width,
    height: size.height,
    byteLength: pngBuffer.byteLength,
    fingerprint: hashString(pngBuffer.toString("base64").slice(0, 4096)),
    imageBase64: pngBuffer.toString("base64")
  };
}

function buildCompactPageState(page) {
  if (!page) {
    return null;
  }

  return {
    title: page.title || "",
    url: page.url || "",
    signature: page.signature || "",
    viewport: page.viewport || null,
    metadata: page.metadata || null,
    landmarks: Array.isArray(page.landmarks) ? page.landmarks.slice(0, 6) : [],
    forms: Array.isArray(page.forms) ? page.forms.slice(0, 4) : [],
    topElements: Array.isArray(page.interactiveElements)
      ? page.interactiveElements.slice(0, 8).map((entry) => ({
        id: entry.id,
        rank: entry.rank,
        tag: entry.tag,
        role: entry.role,
        type: entry.type,
        text: entry.text,
        rect: entry.rect
      }))
      : []
  };
}

function buildPageStateDiff(previousPage, currentPage) {
  if (!currentPage) {
    return null;
  }

  if (!previousPage) {
    return {
      changed: true,
      summary: "Captured the first page-state baseline for this tab.",
      changes: ["Initial page observation recorded."]
    };
  }

  const changes = [];
  if (previousPage.url !== currentPage.url) {
    changes.push(`URL changed to ${formatDisplayUrl(currentPage.url || "")}.`);
  }
  if (previousPage.title !== currentPage.title) {
    changes.push(`Title changed to "${truncate(currentPage.title || "Untitled", 80)}".`);
  }
  if (previousPage.signature !== currentPage.signature) {
    changes.push("The ranked page structure changed.");
  }

  const previousIds = new Set((previousPage.interactiveElements || []).map((entry) => entry.id));
  const currentIds = new Set((currentPage.interactiveElements || []).map((entry) => entry.id));
  const added = (currentPage.interactiveElements || []).filter((entry) => !previousIds.has(entry.id)).slice(0, 5);
  const removed = (previousPage.interactiveElements || []).filter((entry) => !currentIds.has(entry.id)).slice(0, 5);

  if (added.length) {
    changes.push(`New interactive targets appeared: ${added.map((entry) => entry.text || entry.tag).join(", ")}.`);
  }
  if (removed.length) {
    changes.push(`Interactive targets disappeared: ${removed.map((entry) => entry.text || entry.tag).join(", ")}.`);
  }

  if ((previousPage.viewport?.scrollY || 0) !== (currentPage.viewport?.scrollY || 0)) {
    changes.push(`Scroll position moved to ${currentPage.viewport?.scrollY || 0}px.`);
  }

  if ((previousPage.forms?.length || 0) !== (currentPage.forms?.length || 0)) {
    changes.push(`Form count changed from ${previousPage.forms?.length || 0} to ${currentPage.forms?.length || 0}.`);
  }

  if ((previousPage.landmarks?.length || 0) !== (currentPage.landmarks?.length || 0)) {
    changes.push(`Landmark count changed from ${previousPage.landmarks?.length || 0} to ${currentPage.landmarks?.length || 0}.`);
  }

  if (previousPage.visualGrounding?.screenshot?.fingerprint && currentPage.visualGrounding?.screenshot?.fingerprint &&
    previousPage.visualGrounding.screenshot.fingerprint !== currentPage.visualGrounding.screenshot.fingerprint) {
    changes.push("The screenshot grounding changed.");
  }

  return {
    changed: changes.length > 0,
    summary: changes.length ? changes.slice(0, 3).join(" ") : "No major page-state changes detected.",
    changes
  };
}

function cloneObservedPage(page) {
  return page ? JSON.parse(JSON.stringify(page)) : null;
}

function mergeSummaries(primary, secondary) {
  if (!primary) {
    return secondary || "";
  }
  if (!secondary) {
    return primary;
  }

  return `${primary} ${secondary}`;
}

function serializeToolResult(result) {
  return result ? JSON.parse(JSON.stringify(result, (key, value) => key === "imageBase64" ? undefined : value)) : result;
}

function buildVisualGroundingMessage(modelName, toolName, result) {
  if (!modelSupportsVision(modelName)) {
    return null;
  }

  const visualContext = result?.visualContext;
  if (!visualContext?.imageBase64) {
    return null;
  }

  const content = [
    `Visual grounding for ${toolName}.`,
    visualContext.summary || "A screenshot of the current viewport is attached.",
    visualContext.ocr?.ok && visualContext.ocr.text
      ? `OCR excerpt: ${truncate(visualContext.ocr.text, 900)}`
      : "OCR text was unavailable for this screenshot.",
    "Use the attached image to verify layout, visually rendered text, and on-screen element positions."
  ].join("\n");

  return {
    role: "user",
    content,
    images: [visualContext.imageBase64]
  };
}

function modelSupportsVision(modelName) {
  const name = String(modelName || "");
  return VISION_MODEL_PATTERNS.some((pattern) => pattern.test(name));
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

function buildDirectConversationReply(task) {
  const normalized = normalizeConversationIntentText(task);
  if (!normalized) {
    return null;
  }

  if (isPureGreeting(normalized)) {
    return "Hi. I can inspect the current page, summarize what is visible, explain forms and buttons, and take browser actions like click, type, search, and navigate. Try \"summarize this page\" or \"click the top result.\"";
  }

  if (isPureThanks(normalized)) {
    return "Happy to help. If you want, I can inspect this page or take the next browser step for you.";
  }

  if (isCapabilityQuestion(normalized) && !hasBrowserTaskHints(normalized)) {
    return "I can inspect the current page, summarize what is visible, explain what is on screen, click buttons, type into forms, search, navigate, compare options, and monitor pages. Try \"what do you see?\", \"summarize this page\", or \"click the top result.\"";
  }

  if (isIdentityQuestion(normalized) && !hasBrowserTaskHints(normalized)) {
    return "I am your browser assistant inside ElectronBrowser. I can read the current page, explain it, and take browser actions when you ask.";
  }

  if (isStatusQuestion(normalized) && !hasBrowserTaskHints(normalized)) {
    return "I am ready. Ask me to summarize this page, explain what is on screen, or take a browser action like click, type, search, or navigate.";
  }

  return null;
}

function normalizeConversationIntentText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function hasBrowserTaskHints(value) {
  const text = normalizeConversationIntentText(value);
  return [
    /\b(click|tap|press|open|open up|search|find|look up|research|go to|navigate|visit|scroll|type|enter|fill|submit|compare|monitor|watch|reload|go back|back|forward|switch|close|hover|move|read|inspect|summari[sz]e|explain|describe)\b/i,
    /\b(this page|current page|current tab|this tab|site|website|tab|url|button|link|form|search results|browser)\b/i,
    /\b(sign in|log in|login|password|checkout|buy|pay|upload|download)\b/i
  ].some((pattern) => pattern.test(text));
}

function isPureGreeting(value) {
  return /^(hi|hello|hey|heya|hiya|yo|sup|what'?s up|good morning|good afternoon|good evening)( there)?[!.?]*$/i.test(value);
}

function isPureThanks(value) {
  return /^(thanks|thank you|thanks a lot|thank you very much|thx|ty)[!.?]*$/i.test(value);
}

function isCapabilityQuestion(value) {
  return /^(help|what can you do|what do you do|how can you help|what are you able to do|show me what you can do)\??$/i.test(value);
}

function isIdentityQuestion(value) {
  return /^(who are you|what are you)\??$/i.test(value);
}

function isStatusQuestion(value) {
  return /^(how are you|are you there|you there|ready|are you ready)\??$/i.test(value);
}

function normalizeArguments(argumentsValue) {
  if (!argumentsValue) {
    return {};
  }

  if (typeof argumentsValue === "string") {
    try {
      return JSON.parse(argumentsValue);
    } catch {
      return {
        __parseError: "Tool call arguments were not valid JSON."
      };
    }
  }

  return argumentsValue;
}

function validateToolArguments(name, args) {
  if (args?.__parseError) {
    return {
      ok: false,
      error: args.__parseError,
      failureCategory: "invalid_arguments"
    };
  }

  const definition = TOOL_DEFINITION_MAP.get(name);
  const required = Array.isArray(definition?.function?.parameters?.required)
    ? definition.function.parameters.required
    : [];

  for (const field of required) {
    const value = args?.[field];
    if (value === undefined || value === null || typeof value === "string" && !value.trim()) {
      return {
        ok: false,
        error: `${name} requires "${field}".`,
        failureCategory: "invalid_arguments"
      };
    }
  }

  return null;
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
  const diffSummary = result.pageStateDiff?.summary ? ` ${result.pageStateDiff.summary}` : "";
  if (result.summary) {
    return `${name}: ${result.summary}${diffSummary}`;
  }
  if (result.error) {
    return `${name} failed: ${result.error}`;
  }
  return `${name}: completed.`;
}

function buildConversationHistoryMessages() {
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

  return conversationMessages;
}

function buildConversationMessages(systemPrompt = SYSTEM_PROMPT) {
  return [
    { role: "system", content: systemPrompt },
    ...buildConversationHistoryMessages()
  ];
}

function formatObservationForPrompt(page, { includeVisibleText } = {}) {
  if (!page) {
    return "No page observation available.";
  }

  const lines = [
    `Title: ${page.title || "Untitled"}`,
    `URL: ${formatDisplayUrl(page.url || "") || "unknown"}`,
    `Ready state: ${page.readyState || "unknown"}`,
    `Page type: ${page.metadata?.pageType || "general"}`,
    `Viewport scroll: ${page.viewport?.scrollY || 0}px`,
    page.landmarks?.length
      ? `Landmarks: ${page.landmarks.slice(0, 6).map((entry) => `${entry.role}${entry.name ? ` (${entry.name})` : ""}`).join("; ")}`
      : "Landmarks: none detected",
    page.forms?.length
      ? `Forms: ${page.forms.slice(0, 4).map((entry) => `${entry.name || "unnamed form"} with ${entry.fieldCount} fields`).join("; ")}`
      : "Forms: none detected",
    page.interactiveElements?.length
      ? `Top interactive elements: ${page.interactiveElements.slice(0, 8).map((entry) => `#${entry.rank} id=${entry.id} ${entry.tag}${entry.label ? ` label="${truncate(entry.label, 40)}"` : ""}${entry.text ? ` text="${truncate(entry.text, 60)}"` : ""}`).join("; ")}`
      : "Top interactive elements: none detected",
    page.visualGrounding?.ok === false
      ? "Visual grounding: unavailable for this observation."
      : "",
    page.visualGrounding?.ocr?.ok && page.visualGrounding.ocr.text
      ? `OCR excerpt: ${truncate(page.visualGrounding.ocr.text, 500)}`
      : ""
  ];

  if (includeVisibleText && page.visibleText) {
    lines.push(`Visible text excerpt: ${truncate(page.visibleText, 700)}`);
  }

  return lines.filter(Boolean).join("\n");
}

function normalizeExecutionPlan(parsedPlan, task, workflowContext) {
  const rawSteps = Array.isArray(parsedPlan)
    ? parsedPlan
    : Array.isArray(parsedPlan?.steps)
      ? parsedPlan.steps
      : [];

  const steps = rawSteps
    .map((step, index) => ({
      id: `step-${index + 1}`,
      objective: truncate(String(step?.objective || step?.title || "").trim(), 180),
      successCriteria: truncate(String(step?.successCriteria || step?.expected || step?.objective || "").trim(), 220)
    }))
    .filter((step) => step.objective)
    .slice(0, MAX_PLAN_STEPS);

  if (!steps.length) {
    const workflowFallback = buildWorkflowFallbackPlan(task, workflowContext);
    return {
      summary: workflowFallback.summary,
      workflow: workflowContext?.selected || null,
      steps: workflowFallback.steps
    };
  }

  return {
    summary: truncate(String(parsedPlan?.summary || "Complete the request in a few verified browser steps.").trim(), 220),
    workflow: workflowContext?.selected || null,
    steps
  };
}

function formatExecutionPlan(plan) {
  const prefix = plan.workflow?.name ? `[${plan.workflow.name}] ` : "";
  return `${prefix}${plan.steps.map((step, index) => `${index + 1}. ${step.objective}`).join(" ")}`;
}

function buildExecutorPrompt({ task, taskId, plan, step, stepIndex, completedSteps, verifierFeedback, latestObservation }) {
  const memoryContext = buildRelevantMemoryContext(task, taskId);
  return [
    `User request: ${task}`,
    `Plan summary: ${plan.summary}`,
    plan.workflow?.name ? `Selected workflow: ${plan.workflow.name}` : "",
    `Current step (${stepIndex + 1}/${plan.steps.length}): ${step.objective}`,
    `Success criteria: ${step.successCriteria}`,
    completedSteps.length
      ? `Completed steps: ${completedSteps.map((entry) => entry.objective).join(" | ")}`
      : "Completed steps: none",
    `Relevant memory:\n${formatMemoryContext(memoryContext)}`,
    latestObservation?.page
      ? `Latest observation:\n${formatObservationForPrompt(latestObservation.page, { includeVisibleText: false })}`
      : "Latest observation: use inspect_page if you need fresh page facts.",
    verifierFeedback ? `Verifier feedback from the last attempt:\n${verifierFeedback}` : "",
    "Use tools only for this step. When the step is done, reply with a concise completion summary."
  ].filter(Boolean).join("\n\n");
}

function normalizeVerificationResult(parsedResult, observation) {
  const verdict = ["complete", "retry", "blocked"].includes(parsedResult?.verdict)
    ? parsedResult.verdict
    : observation?.pageStateDiff?.changed
      ? "retry"
      : "blocked";

  return {
    verdict,
    reason: truncate(String(parsedResult?.reason || parsedResult?.message || (verdict === "complete" ? "The step appears complete." : "The step is not yet verified.")).trim(), 220),
    evidence: truncate(String(parsedResult?.evidence || observation?.pageStateDiff?.summary || "").trim(), 260),
    nextActionHint: truncate(String(parsedResult?.nextActionHint || "").trim(), 220)
  };
}

function formatStepOutcome(entry, index) {
  return [
    `${index + 1}. ${entry.objective}`,
    `   Verdict: ${entry.verification?.verdict || "unknown"}`,
    `   Executor: ${entry.executorSummary || "No executor summary."}`,
    entry.verification?.reason ? `   Verifier: ${entry.verification.reason}` : "",
    entry.observationSummary ? `   Page diff: ${entry.observationSummary}` : ""
  ].filter(Boolean).join("\n");
}

function buildLocalFinalSummary(task, completedSteps) {
  const blockedStep = completedSteps.find((entry) => entry.verification?.verdict !== "complete") || null;
  if (!completedSteps.length) {
    return `I wasn't able to make progress on "${task}".`;
  }

  if (blockedStep) {
    return `I made progress on "${task}", but stopped at "${blockedStep.objective}" because ${blockedStep.verification?.reason || "it could not be verified"}.`;
  }

  return completedSteps
    .map((entry) => entry.executorSummary)
    .filter(Boolean)
    .join(" ");
}

function parseJsonResponse(content) {
  const text = String(content || "").trim();
  if (!text) {
    return null;
  }

  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }

  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    candidates.push(text.slice(objectStart, objectEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep trying narrower candidates.
    }
  }

  return null;
}

function buildWorkflowContext(task, page, memoryContext) {
  const builtinCandidates = scoreBuiltinWorkflowRecipes(task, page);
  const learnedCandidate = selectLearnedWorkflow(task, memoryContext);
  const candidates = [
    learnedCandidate,
    ...builtinCandidates
  ]
    .filter(Boolean)
    .sort(compareWorkflowCandidates)
    .slice(0, WORKFLOW_CANDIDATE_LIMIT);
  const selected = chooseWorkflowCandidate(candidates);

  return {
    selected,
    candidates,
    builtins: BUILTIN_WORKFLOW_RECIPES,
    builtinCandidates,
    learnedCandidate,
    learned: Array.isArray(memoryContext?.workflows) ? memoryContext.workflows : []
  };
}

function selectBuiltinWorkflowRecipe(task, page) {
  return chooseWorkflowCandidate(scoreBuiltinWorkflowRecipes(task, page));
}

function scoreBuiltinWorkflowRecipes(task, page) {
  const taskText = normalizeWorkflowMatcherText(task);
  const pageText = buildWorkflowPageMatcherText(page);
  const pageType = normalizeWorkflowMatcherText(page?.metadata?.pageType || "");

  return BUILTIN_WORKFLOW_RECIPES
    .map((recipe) => {
      const taskSignals = Array.from(new Set([...(recipe.taskSignals || []), ...(recipe.matchKeywords || [])]));
      const taskHits = collectWorkflowSignalMatches(taskText, taskSignals);
      const pageHits = collectWorkflowSignalMatches(pageText, recipe.pageSignals || []);
      const negativeHits = collectWorkflowSignalMatches(taskText, recipe.negativeTaskSignals || []);

      let score = (taskHits.length * WORKFLOW_TASK_SIGNAL_WEIGHT)
        + (pageHits.length * WORKFLOW_PAGE_SIGNAL_WEIGHT)
        - (negativeHits.length * WORKFLOW_NEGATIVE_SIGNAL_WEIGHT);

      if (taskHits.length && pageHits.length) {
        score += 0.5;
      }

      if (pageType && pageHits.some((entry) => normalizeWorkflowMatcherText(entry) === pageType)) {
        score += 0.5;
      }

      if (negativeHits.length && !taskHits.length) {
        score -= 1;
      }

      const reasons = [];
      if (taskHits.length) {
        reasons.push(`task intent matched ${taskHits.join(", ")}`);
      }
      if (pageHits.length) {
        reasons.push(`page context matched ${pageHits.join(", ")}`);
      }
      if (negativeHits.length) {
        reasons.push(`conflicting task intent ${negativeHits.join(", ")}`);
      }

      return {
        ...recipe,
        source: "builtin",
        score,
        confidence: 0,
        taskHits,
        pageHits,
        negativeHits,
        reasons
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(compareWorkflowCandidates)
    .map((candidate, index, entries) => ({
      ...candidate,
      confidence: estimateWorkflowConfidence(candidate, entries[0], entries[1], index)
    }))
    .sort(compareWorkflowCandidates)
    .slice(0, WORKFLOW_CANDIDATE_LIMIT);
}

function chooseWorkflowCandidate(candidates) {
  const ranked = Array.isArray(candidates)
    ? candidates.filter(Boolean).sort(compareWorkflowCandidates)
    : [];
  const top = ranked[0];
  const runnerUp = ranked[1];

  if (!top) {
    return null;
  }

  if ((top.confidence || 0) < WORKFLOW_CONFIDENCE_THRESHOLD) {
    return null;
  }

  if (runnerUp) {
    const closeConfidence = Math.abs((top.confidence || 0) - (runnerUp.confidence || 0)) < 0.08;
    const closeScore = Math.abs((top.score || 0) - (runnerUp.score || 0)) < 1.5;
    if (closeConfidence && closeScore) {
      return null;
    }
  }

  return top;
}

function compareWorkflowCandidates(left, right) {
  if ((right?.confidence || 0) !== (left?.confidence || 0)) {
    return (right?.confidence || 0) - (left?.confidence || 0);
  }
  if ((right?.score || 0) !== (left?.score || 0)) {
    return (right?.score || 0) - (left?.score || 0);
  }
  if ((right?.taskHits?.length || 0) !== (left?.taskHits?.length || 0)) {
    return (right?.taskHits?.length || 0) - (left?.taskHits?.length || 0);
  }
  return String(left?.name || "").localeCompare(String(right?.name || ""));
}

function estimateWorkflowConfidence(candidate, topCandidate, runnerUpCandidate, index) {
  const isTopCandidate = index === 0;
  const scoreGap = isTopCandidate
    ? (candidate.score || 0) - (runnerUpCandidate?.score || 0)
    : (candidate.score || 0) - (topCandidate?.score || 0);
  let confidence = 0.18
    + ((candidate.taskHits?.length || 0) * 0.18)
    + ((candidate.pageHits?.length || 0) * 0.06)
    - ((candidate.negativeHits?.length || 0) * 0.22);

  if ((candidate.score || 0) >= WORKFLOW_SELECTION_SCORE_THRESHOLD) {
    confidence += 0.08;
  }

  confidence += isTopCandidate
    ? Math.min(0.18, Math.max(0, scoreGap / 6))
    : -Math.min(0.25, Math.max(0, Math.abs(scoreGap) / 6));

  if (!candidate.taskHits?.length && (candidate.pageHits?.length || 0) < 2) {
    confidence -= 0.12;
  }

  return clampNumber(confidence, 0.05, 0.95, 0.5);
}

function buildWorkflowPageMatcherText(page) {
  return normalizeWorkflowMatcherText([
    page?.metadata?.pageType,
    page?.title,
    page?.url
  ].filter(Boolean).join(" "));
}

function collectWorkflowSignalMatches(text, signals) {
  const normalizedText = normalizeWorkflowMatcherText(text);
  if (!normalizedText) {
    return [];
  }

  return Array.from(new Set((signals || []).filter((signal) => workflowSignalMatchesText(normalizedText, signal))));
}

function workflowSignalMatchesText(text, signal) {
  const normalizedSignal = normalizeWorkflowMatcherText(signal);
  if (!normalizedSignal) {
    return false;
  }

  const pattern = new RegExp(`(^|\\s)${escapeWorkflowRegExp(normalizedSignal).replace(/\s+/g, "\\s+")}(?=\\s|$)`, "i");
  return pattern.test(text);
}

function normalizeWorkflowMatcherText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeWorkflowRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function selectLearnedWorkflow(task, memoryContext) {
  const workflows = Array.isArray(memoryContext?.workflows) ? memoryContext.workflows : [];
  const fingerprint = buildTaskFingerprint(task);
  const candidate = workflows
    .filter((entry) =>
      taskFingerprintsOverlap(fingerprint, entry.taskSnippet || "") &&
      (entry.successCount || 0) > 0
    )
    .map((entry) => {
      const overlap = countTaskFingerprintOverlap(fingerprint, entry.taskSnippet || "");
      const successRate = entry.runCount ? (entry.successCount || 0) / entry.runCount : 0;
      const confidence = clampNumber(0.26 + (overlap * 0.14) + (successRate * 0.28), 0.05, 0.9, 0.45);
      return {
        ...entry,
        overlap,
        confidence
      };
    })
    .sort((left, right) => {
      if ((right.confidence || 0) !== (left.confidence || 0)) {
        return (right.confidence || 0) - (left.confidence || 0);
      }
      return (right.successCount || 0) - (left.successCount || 0);
    })[0];

  if (!candidate) {
    return null;
  }

  return {
    id: candidate.key,
    name: candidate.taskSnippet || "Learned workflow",
    source: "learned",
    score: candidate.overlap || 0,
    confidence: candidate.confidence || 0.6,
    inputs: ["task goal"],
    outputs: ["verified browser state"],
    successConditions: [candidate.finalSummary || "The workflow completes with a verified result."],
    retryRules: ["Retry using the stored successful pattern, then re-inspect the page."],
    steps: Array.isArray(candidate.stepsPreview) ? candidate.stepsPreview : [],
    reasons: [`matched a prior successful workflow with ${candidate.overlap || 0} shared task cues`]
  };
}

function formatWorkflowContext(workflowContext) {
  const lines = [];
  if (workflowContext?.selected) {
    lines.push(`Recommended workflow: ${workflowContext.selected.name} (${workflowContext.selected.source}, ${Math.round((workflowContext.selected.confidence || 0) * 100)}% confidence).`);
    lines.push(`Inputs: ${(workflowContext.selected.inputs || []).join(", ") || "task goal"}`);
    lines.push(`Outputs: ${(workflowContext.selected.outputs || []).join(", ") || "verified result"}`);
    lines.push(`Success conditions: ${(workflowContext.selected.successConditions || []).join("; ") || "Task completed and verified."}`);
    lines.push(`Retry rules: ${(workflowContext.selected.retryRules || []).join("; ") || "Re-inspect and retry carefully."}`);
    if (workflowContext.selected.reasons?.length) {
      lines.push(`Why this fits: ${workflowContext.selected.reasons.join("; ")}`);
    }
    if (workflowContext.selected.steps?.length) {
      lines.push(`Recipe steps: ${workflowContext.selected.steps.join(" | ")}`);
    }
  } else if (workflowContext?.candidates?.length) {
    lines.push("No exact workflow lock yet. Use the leading candidates as hints, not hard instructions.");
  } else {
    lines.push("No exact workflow match yet. Use the browser workflow library conservatively.");
  }

  if (workflowContext?.candidates?.length) {
    lines.push(`Candidate ranking: ${workflowContext.candidates.map((candidate) => `${candidate.name} [${candidate.source}, ${Math.round((candidate.confidence || 0) * 100)}%, score ${Number(candidate.score || 0).toFixed(1)}]`).join(" | ")}`);
  }

  if (workflowContext?.learned?.length) {
    lines.push(`Learned examples: ${workflowContext.learned.slice(0, 3).map((entry) => `${entry.taskSnippet} (${entry.successCount || 0}/${entry.runCount || 0})`).join(" | ")}`);
  }

  return lines.join("\n");
}

function buildWorkflowFallbackPlan(task, workflowContext) {
  const selected = workflowContext?.selected;
  if (!selected || !selected.steps?.length) {
    return {
      summary: "Single-step fallback plan.",
      steps: [{
        id: "step-1",
        objective: truncate(task, 180),
        successCriteria: "The user's request is completed and the browser state confirms it."
      }]
    };
  }

  return {
    summary: `${selected.name} workflow fallback plan.`,
    steps: selected.steps.slice(0, MAX_PLAN_STEPS).map((objective, index) => ({
      id: `step-${index + 1}`,
      objective: truncate(objective, 180),
      successCriteria: truncate(selected.successConditions?.[Math.min(index, (selected.successConditions?.length || 1) - 1)] || "The step has a clear, observable result.", 220)
    }))
  };
}

function normalizeTrustedOriginsInput(value) {
  return parseTrustedOrigins(value).join("\n");
}

function parseTrustedOrigins(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => entry.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((entry, index, entries) => entries.indexOf(entry) === index);
}

function isTrustedOrigin(url) {
  const domain = extractMemoryDomain(url);
  if (!domain) {
    return true;
  }

  const trustedOrigins = parseTrustedOrigins(state.settings.trustedOrigins);
  return trustedOrigins.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

function updatePolicyGuidance(trustedOriginsValue) {
  const trustedOrigins = parseTrustedOrigins(trustedOriginsValue);
  if (!trustedOrigins.length) {
    elements.policyGuidance.textContent = "No trusted origins saved yet. Mutating actions outside obviously safe contexts will ask for approval.";
    elements.policyGuidance.className = "policy-guidance warning";
    return;
  }

  elements.policyGuidance.textContent = `Trusted origins: ${trustedOrigins.join(", ")}. Sensitive or destructive actions still require approval.`;
  elements.policyGuidance.className = "policy-guidance";
}

async function evaluateSafetyPolicy(toolName, args) {
  const tab = getActiveTab();
  const currentUrl = tab?.url || "";
  const trusted = isTrustedOrigin(currentUrl);
  const observedPage = tab?.lastObservedPage || null;
  const targetHints = collectPolicyTargetHints(toolName, args, observedPage);
  const combinedHints = targetHints.join(" ").toLowerCase();
  const pageText = [
    observedPage?.visibleText || "",
    observedPage?.visualGrounding?.ocr?.text || ""
  ].join(" ").toLowerCase();

  if (pageText.includes("captcha") || pageText.includes("recaptcha") || pageText.includes("human verification")) {
    return {
      blocked: true,
      requiresApproval: false,
      reason: "CAPTCHA or human verification detected. The browser should stop and ask for your help."
    };
  }

  const isSensitive = SENSITIVE_ACTION_PATTERNS.some((pattern) => pattern.test(combinedHints));
  const isMutating = MUTATING_TOOLS.has(toolName);
  const destinationDomain = ["navigate_to", "open_or_search"].includes(toolName)
    ? extractMemoryDomain(normalizeDestination(args.url || args.query || ""))
    : "";
  const crossOriginNavigation = Boolean(destinationDomain && destinationDomain !== extractMemoryDomain(currentUrl) && !isTrustedOrigin(`https://${destinationDomain}`));
  const authWall = observedPage?.metadata?.pageType === "login";
  const targetElement = findObservedElementById(observedPage, args.elementId);
  const passwordField = targetElement?.type === "password";

  if (isSensitive) {
    return {
      blocked: false,
      requiresApproval: true,
      reason: `Sensitive browser action detected for ${toolName}. Approval is required.`
    };
  }

  if (passwordField || authWall && toolName === "type_into_element") {
    return {
      blocked: false,
      requiresApproval: true,
      reason: "You are about to enter credentials on a login page. Approval is required."
    };
  }

  if (crossOriginNavigation) {
    return {
      blocked: false,
      requiresApproval: true,
      reason: `Navigation to untrusted origin ${destinationDomain} requires approval.`
    };
  }

  if (isMutating && !trusted) {
    return {
      blocked: false,
      requiresApproval: true,
      reason: `Mutating action on untrusted origin ${extractMemoryDomain(currentUrl) || "unknown"} requires approval.`
    };
  }

  return {
    blocked: false,
    requiresApproval: false,
    reason: ""
  };
}

function collectPolicyTargetHints(toolName, args, observedPage) {
  const hints = [toolName, state.currentTask || ""];
  if (typeof args?.query === "string") {
    hints.push(args.query);
  }
  if (typeof args?.url === "string") {
    hints.push(args.url);
  }
  if (typeof args?.text === "string") {
    hints.push(args.text);
  }
  if (typeof args?.elementHint === "string") {
    hints.push(args.elementHint);
  }

  const target = findObservedElementById(observedPage, args?.elementId);
  if (target) {
    hints.push(target.text || "", target.name || "", target.role || "", target.type || "");
  }

  return hints.filter(Boolean);
}

function findObservedElementById(observedPage, elementId) {
  if (!observedPage || !elementId) {
    return null;
  }

  const interactive = Array.isArray(observedPage.interactiveElements) ? observedPage.interactiveElements : [];
  return interactive.find((entry) => entry.id === elementId) || null;
}

function categorizeExecutionFailure({ verification, lastToolExecution, observation }) {
  const explicitFailureCategory = lastToolExecution?.transcriptResult?.failureCategory;
  if (explicitFailureCategory) {
    return explicitFailureCategory;
  }

  const combined = [
    verification?.reason || "",
    verification?.evidence || "",
    lastToolExecution?.transcriptResult?.error || "",
    observation?.page?.visibleText || "",
    observation?.page?.visualGrounding?.ocr?.text || ""
  ].join(" ").toLowerCase();

  if (combined.includes("captcha") || combined.includes("recaptcha") || combined.includes("human verification")) {
    return "captcha";
  }
  if (combined.includes("login") || combined.includes("sign in") || combined.includes("authentication")) {
    return "auth_wall";
  }
  if (combined.includes("ambiguous") || combined.includes("multiple similar elements")) {
    return "ambiguous_element";
  }
  if (combined.includes("not found") || combined.includes("inspect the page again") || combined.includes("missing")) {
    return "missing_element";
  }
  if (combined.includes("did not keep the expected value") || combined.includes("input was rejected")) {
    return "input_rejected";
  }
  if (combined.includes("timed out") || combined.includes("navigation failed") || combined.includes("unable to restore")) {
    return "navigation";
  }
  if (combined.includes("policy") || combined.includes("approval")) {
    return combined.includes("denied") ? "approval_denied" : "policy_blocked";
  }

  const activeDomain = state.memory.activeGoal?.activeDomain || "";
  const currentDomain = extractMemoryDomain(getActiveTab()?.url || "");
  if (activeDomain && currentDomain && activeDomain !== currentDomain) {
    return "wrong_domain";
  }

  if (observation?.pageStateDiff && !observation.pageStateDiff.changed) {
    return "no_state_change";
  }

  return "general";
}

async function attemptAutomaticRecovery({ taskId, step, verification, failureCategory, lastToolExecution, observation, budget }) {
  const currentDomain = extractMemoryDomain(getActiveTab()?.url || "");
  const targetDomain = state.memory.activeGoal?.activeDomain || currentDomain;
  let note = "";
  let success = false;
  let blocked = false;
  let nextActionHint = "";

  switch (failureCategory) {
    case "captcha":
      blocked = true;
      note = "CAPTCHA or human verification needs direct user help.";
      nextActionHint = "Pause the agent and complete the verification manually.";
      break;
    case "auth_wall":
      blocked = true;
      note = "Authentication boundary detected. The browser should wait for user approval or credentials.";
      nextActionHint = "Help the browser complete login or provide credentials manually.";
      break;
    case "missing_element":
    case "ambiguous_element":
    case "input_rejected":
      await observeCurrentPage({
        includeText: false,
        includeMetadata: true,
        includeScreenshot: false,
        includeOcr: false,
        includeDiff: true
      });
      note = failureCategory === "input_rejected"
        ? "Re-inspected the page after the page rejected input."
        : "Re-inspected the page after an element lookup failure.";
      success = true;
      break;
    case "navigation":
      await reloadActiveTab();
      await observeCurrentPage({
        includeText: false,
        includeMetadata: true,
        includeScreenshot: false,
        includeOcr: false,
        includeDiff: true
      });
      note = "Reloaded the current tab after a navigation or load failure.";
      success = true;
      break;
    case "wrong_domain": {
      const matchingTab = state.tabs.find((tab) => extractMemoryDomain(tab.url || "") === targetDomain);
      if (matchingTab) {
        selectTab(matchingTab.id);
        note = `Switched back to the ${targetDomain} tab to recover context.`;
        success = true;
      } else if (getActiveTab()?.webview?.canGoBack?.()) {
        await goBack();
        note = "Went back one step to recover the expected browsing context.";
        success = true;
      } else {
        note = "Could not automatically recover the expected domain context.";
      }
      break;
    }
    case "no_state_change":
      if (lastToolExecution?.name === "click_element" || lastToolExecution?.name === "type_into_element") {
        await observeCurrentPage({
          includeText: false,
          includeMetadata: true,
          includeScreenshot: false,
          includeOcr: false,
          includeDiff: true
        });
        note = "Re-inspected the page because the last action did not change state.";
        success = true;
      } else {
        note = "No page-state change detected; the next executor attempt should inspect and choose a different action.";
      }
      break;
    default:
      note = `No automatic recovery path was triggered for ${FAILURE_CATEGORIES[failureCategory] || failureCategory}.`;
      break;
  }

  recordRecoveryTelemetry(taskId, step, failureCategory, success, note);
  return {
    blocked,
    recovered: success,
    note,
    nextActionHint
  };
}

function recordTaskTelemetryStart(taskId, task) {
  state.telemetry.summary.taskRuns += 1;
  state.telemetry.activeRun = {
    taskId,
    task: truncate(task, 180),
    workflowName: "",
    startedAt: new Date().toISOString(),
    recoveries: 0,
    failureCategory: "",
    status: "running"
  };
  pushTelemetryEvent("task", `Started task: ${truncate(task, 120)}`);
  persistTelemetry();
}

function updateTaskTelemetryPlan(taskId, plan) {
  if (state.telemetry.activeRun?.taskId !== taskId) {
    return;
  }
  state.telemetry.activeRun.workflowName = plan.workflow?.name || "";
  pushTelemetryEvent("plan", `Plan created${plan.workflow?.name ? ` with workflow ${plan.workflow.name}` : ""}.`);
  persistTelemetry();
}

function recordTaskTelemetryFinish(taskId, status, completedSteps, message) {
  if (status === "completed") {
    state.telemetry.summary.taskSuccesses += 1;
  } else {
    state.telemetry.summary.taskBlocked += 1;
  }

  if (status !== "completed" && message) {
    state.telemetry.lastFailure = truncate(message, 180);
  }

  if (state.telemetry.activeRun?.taskId === taskId) {
    state.telemetry.activeRun.status = status;
    state.telemetry.activeRun.finishedAt = new Date().toISOString();
    state.telemetry.activeRun.completedSteps = completedSteps.length;
    if (message) {
      state.telemetry.activeRun.failureCategory = message;
    }
    pushTelemetryEvent("task", `Task ${status}: ${state.telemetry.activeRun.task}`);
    state.telemetry.activeRun = null;
  }
  persistTelemetry();
}

function recordStepTelemetryAttempt(taskId, step, attempt) {
  state.telemetry.summary.stepAttempts += 1;
  pushTelemetryEvent("step", `Attempt ${attempt} for ${truncate(step.objective, 90)}`);
  persistTelemetry();
}

function recordStepTelemetryVerification(taskId, step, verification, failureCategory) {
  if (verification?.verdict === "complete") {
    state.telemetry.summary.stepSuccesses += 1;
  } else if (failureCategory) {
    state.telemetry.failureCategories[failureCategory] = (state.telemetry.failureCategories[failureCategory] || 0) + 1;
    state.telemetry.lastFailure = truncate(`${FAILURE_CATEGORIES[failureCategory] || failureCategory}: ${verification?.reason || ""}`, 180);
  }
  persistTelemetry();
}

function recordRecoveryTelemetry(taskId, step, failureCategory, success, note) {
  state.telemetry.summary.recoveryAttempts += 1;
  if (success) {
    state.telemetry.summary.recoverySuccesses += 1;
  }
  if (state.telemetry.activeRun?.taskId === taskId) {
    state.telemetry.activeRun.recoveries = (state.telemetry.activeRun.recoveries || 0) + 1;
    state.telemetry.activeRun.failureCategory = failureCategory;
  }
  pushTelemetryEvent("recovery", `${success ? "Recovered" : "Recovery attempted"} after ${FAILURE_CATEGORIES[failureCategory] || failureCategory}: ${truncate(note, 100)}`);
  persistTelemetry();
}

function recordApprovalTelemetry(approved, reason) {
  if (approved === null) {
    state.telemetry.summary.approvalsRequested += 1;
  } else if (approved === true) {
    state.telemetry.summary.approvalsGranted += 1;
  } else if (approved === false) {
    state.telemetry.summary.approvalsDenied += 1;
    state.telemetry.lastFailure = truncate(reason || "Approval denied.", 180);
  }
  pushTelemetryEvent("approval", truncate(reason || "Approval decision recorded.", 100));
  persistTelemetry();
}

function recordToolTelemetry(name, result) {
  state.telemetry.summary.toolCalls += 1;
  if (result?.failureCategory) {
    state.telemetry.failureCategories[result.failureCategory] = (state.telemetry.failureCategories[result.failureCategory] || 0) + 1;
  }
  pushTelemetryEvent("tool", `${name}: ${truncate(result?.summary || result?.error || "completed", 90)}`);
  persistTelemetry();
}

function pushTelemetryEvent(type, message) {
  state.telemetry.recentEvents.unshift({
    type,
    message: truncate(message, 160),
    timestamp: new Date().toISOString()
  });
  state.telemetry.recentEvents = state.telemetry.recentEvents.slice(0, TELEMETRY_EVENT_LIMIT);
}

function renderTelemetry() {
  elements.telemetryTaskSuccess.textContent = formatPercent(state.telemetry.summary.taskSuccesses, state.telemetry.summary.taskRuns);
  elements.telemetryStepSuccess.textContent = formatPercent(state.telemetry.summary.stepSuccesses, state.telemetry.summary.stepAttempts);
  elements.telemetryApprovalRate.textContent = formatPercent(state.telemetry.summary.approvalsGranted, state.telemetry.summary.approvalsRequested);
  elements.telemetryRecoveryRate.textContent = formatPercent(state.telemetry.summary.recoverySuccesses, state.telemetry.summary.recoveryAttempts);

  const topWorkflow = state.memory.workflows[0];
  elements.telemetryWorkflowSummary.textContent = topWorkflow
    ? `Top learned workflow: ${topWorkflow.taskSnippet} (${topWorkflow.successCount || 0}/${topWorkflow.runCount || 0} successful runs).`
    : "Workflow library is still gathering examples.";
  elements.telemetryLastFailure.textContent = state.telemetry.lastFailure || "No recorded failures yet.";
}

function formatPercent(numerator, denominator) {
  if (!denominator) {
    return "0%";
  }
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function beginGoalMemory(task) {
  const now = new Date().toISOString();
  const domain = extractMemoryDomain(getActiveTab()?.url || "");
  const taskId = `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  state.memory.activeGoal = {
    taskId,
    task: truncate(task, 240),
    status: "running",
    startedAt: now,
    updatedAt: now,
    planSummary: "",
    currentStepIndex: 0,
    currentStepObjective: "Planning the task",
    completedObjectives: [],
    activeDomain: domain,
    fingerprint: buildTaskFingerprint(task)
  };
  upsertGoalCheckpoint({
    taskId,
    task,
    status: "running",
    currentStepIndex: 0,
    currentStepObjective: "Planning the task",
    completedObjectives: [],
    domain,
    planSummary: "",
    observationSummary: "Task planning started.",
    verifierReason: "",
    finalSummary: ""
  });
  persistAgentMemory();
  return taskId;
}

function applyPlanToGoalMemory(taskId, plan, initialObservation) {
  const activeGoal = state.memory.activeGoal;
  if (!activeGoal || activeGoal.taskId !== taskId) {
    return;
  }

  activeGoal.planSummary = truncate(plan.summary || "", 220);
  activeGoal.updatedAt = new Date().toISOString();
  activeGoal.currentStepIndex = plan.steps.length ? 1 : 0;
  activeGoal.currentStepObjective = plan.steps[0]?.objective || "";
  activeGoal.completedObjectives = [];
  upsertGoalCheckpoint({
    taskId,
    task: activeGoal.task,
    status: "running",
    currentStepIndex: activeGoal.currentStepIndex,
    currentStepObjective: activeGoal.currentStepObjective,
    completedObjectives: [],
    domain: activeGoal.activeDomain,
    planSummary: activeGoal.planSummary,
    observationSummary: initialObservation?.pageStateDiff?.summary || "Execution plan created.",
    verifierReason: "",
    finalSummary: ""
  });
  persistAgentMemory();
}

function updateGoalMemoryFromOutcome(taskId, plan, completedSteps) {
  const activeGoal = state.memory.activeGoal;
  if (!activeGoal || activeGoal.taskId !== taskId) {
    return;
  }

  const now = new Date().toISOString();
  const latestOutcome = completedSteps[completedSteps.length - 1] || null;
  const completedObjectives = completedSteps
    .filter((entry) => entry.verification?.verdict === "complete")
    .map((entry) => truncate(entry.objective, 120))
    .slice(-MAX_PLAN_STEPS);
  const nextStep = plan.steps[completedSteps.length] || null;
  const status = latestOutcome?.verification?.verdict === "blocked"
    ? "blocked"
    : nextStep
      ? "running"
      : "completed";

  activeGoal.status = status;
  activeGoal.updatedAt = now;
  activeGoal.completedObjectives = completedObjectives;
  activeGoal.currentStepIndex = nextStep ? completedSteps.length + 1 : null;
  activeGoal.currentStepObjective = nextStep?.objective || "";

  upsertGoalCheckpoint({
    taskId,
    task: activeGoal.task,
    status,
    currentStepIndex: activeGoal.currentStepIndex,
    currentStepObjective: activeGoal.currentStepObjective,
    completedObjectives,
    domain: activeGoal.activeDomain,
    planSummary: activeGoal.planSummary,
    observationSummary: latestOutcome?.observationSummary || "",
    verifierReason: latestOutcome?.verification?.reason || "",
    finalSummary: latestOutcome?.executorSummary || ""
  });
  persistAgentMemory();
}

function completeGoalMemory(taskId, plan, completedSteps, status, finalAnswer) {
  const activeGoal = state.memory.activeGoal;
  const domain = activeGoal?.activeDomain || extractMemoryDomain(getActiveTab()?.url || "");
  const task = activeGoal?.task || "";

  if (activeGoal && activeGoal.taskId === taskId) {
    upsertGoalCheckpoint({
      taskId,
      task,
      status,
      currentStepIndex: null,
      currentStepObjective: "",
      completedObjectives: completedSteps
        .filter((entry) => entry.verification?.verdict === "complete")
        .map((entry) => truncate(entry.objective, 120))
        .slice(-MAX_PLAN_STEPS),
      domain,
      planSummary: activeGoal.planSummary,
      observationSummary: completedSteps[completedSteps.length - 1]?.observationSummary || "",
      verifierReason: completedSteps.find((entry) => entry.verification?.verdict !== "complete")?.verification?.reason || "",
      finalSummary: truncate(finalAnswer || "", 220)
    });
    recordWorkflowMemory({
      task,
      domain,
      status,
      plan,
      completedSteps,
      finalAnswer,
      fingerprint: activeGoal.fingerprint,
      workflow: plan.workflow || null
    });
    state.memory.activeGoal = status === "completed" ? null : {
      ...activeGoal,
      status,
      updatedAt: new Date().toISOString()
    };
  }

  persistAgentMemory();
}

function failGoalMemory(taskId, error) {
  const activeGoal = state.memory.activeGoal;
  if (!activeGoal || activeGoal.taskId !== taskId) {
    return;
  }

  activeGoal.status = "blocked";
  activeGoal.updatedAt = new Date().toISOString();
  upsertGoalCheckpoint({
    taskId,
    task: activeGoal.task,
    status: "blocked",
    currentStepIndex: activeGoal.currentStepIndex,
    currentStepObjective: activeGoal.currentStepObjective,
    completedObjectives: activeGoal.completedObjectives || [],
    domain: activeGoal.activeDomain,
    planSummary: activeGoal.planSummary || "",
    observationSummary: "",
    verifierReason: truncate(error?.message || "Task failed.", 180),
    finalSummary: ""
  });
  persistAgentMemory();
}

function upsertGoalCheckpoint(checkpoint) {
  const normalized = {
    id: checkpoint.taskId,
    taskId: checkpoint.taskId,
    task: truncate(checkpoint.task || "", 240),
    status: checkpoint.status || "running",
    currentStepIndex: checkpoint.currentStepIndex,
    currentStepObjective: truncate(checkpoint.currentStepObjective || "", 160),
    completedObjectives: Array.isArray(checkpoint.completedObjectives) ? checkpoint.completedObjectives.slice(-MAX_PLAN_STEPS) : [],
    domain: checkpoint.domain || "",
    planSummary: truncate(checkpoint.planSummary || "", 220),
    observationSummary: truncate(checkpoint.observationSummary || "", 180),
    verifierReason: truncate(checkpoint.verifierReason || "", 180),
    finalSummary: truncate(checkpoint.finalSummary || "", 220),
    updatedAt: new Date().toISOString()
  };

  const existingIndex = state.memory.checkpoints.findIndex((entry) => entry.taskId === normalized.taskId);
  if (existingIndex === -1) {
    state.memory.checkpoints.unshift(normalized);
  } else {
    state.memory.checkpoints.splice(existingIndex, 1, {
      ...state.memory.checkpoints[existingIndex],
      ...normalized
    });
  }

  state.memory.checkpoints.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  state.memory.checkpoints = state.memory.checkpoints.slice(0, MAX_MEMORY_CHECKPOINTS);
}

function recordWorkflowMemory({ task, domain, status, plan, completedSteps, finalAnswer, fingerprint, workflow }) {
  const key = `${domain || "local"}::${workflow?.id || fingerprint || buildTaskFingerprint(task)}`;
  const existing = state.memory.workflows.find((entry) => entry.key === key);
  const now = new Date().toISOString();
  const base = existing || {
    key,
    domain: domain || "",
    taskSnippet: truncate(task || "", 140),
    fingerprint: fingerprint || buildTaskFingerprint(task),
    workflowId: workflow?.id || "",
    workflowName: workflow?.name || "",
    runCount: 0,
    successCount: 0
  };

  const next = {
    ...base,
    domain: domain || base.domain || "",
    taskSnippet: truncate(task || base.taskSnippet || "", 140),
    workflowId: workflow?.id || base.workflowId || "",
    workflowName: workflow?.name || base.workflowName || "",
    runCount: (base.runCount || 0) + 1,
    successCount: (base.successCount || 0) + (status === "completed" ? 1 : 0),
    lastStatus: status,
    lastRunAt: now,
    planSummary: truncate(plan?.summary || base.planSummary || "", 180),
    stepsPreview: Array.isArray(plan?.steps) ? plan.steps.slice(0, MAX_PLAN_STEPS).map((step) => truncate(step.objective, 100)) : (base.stepsPreview || []),
    finalSummary: truncate(finalAnswer || base.finalSummary || "", 180),
    completedObjectives: completedSteps
      .filter((entry) => entry.verification?.verdict === "complete")
      .map((entry) => truncate(entry.objective, 100))
      .slice(-MAX_PLAN_STEPS)
  };

  if (existing) {
    Object.assign(existing, next);
  } else {
    state.memory.workflows.unshift(next);
  }

  state.memory.workflows.sort((left, right) => {
    if ((right.successCount || 0) !== (left.successCount || 0)) {
      return (right.successCount || 0) - (left.successCount || 0);
    }
    return String(right.lastRunAt || "").localeCompare(String(left.lastRunAt || ""));
  });
  state.memory.workflows = state.memory.workflows.slice(0, MAX_MEMORY_WORKFLOWS);
}

function buildRelevantMemoryContext(task, taskId = "") {
  const domain = extractMemoryDomain(getActiveTab()?.url || "");
  const activeGoal = state.memory.activeGoal;
  const taskFingerprint = buildTaskFingerprint(task);
  const checkpoints = state.memory.checkpoints
    .filter((entry) =>
      entry.taskId === taskId ||
      entry.status === "running" ||
      entry.status === "blocked" ||
      (domain && entry.domain === domain) ||
      taskFingerprintsOverlap(taskFingerprint, entry.task)
    )
    .slice(0, 3);
  const workflows = state.memory.workflows
    .filter((entry) => (domain && entry.domain === domain) || taskFingerprintsOverlap(taskFingerprint, entry.taskSnippet))
    .slice(0, 3);

  return {
    preferences: state.memory.userPreferences.assistant || {},
    activeGoal,
    recentDomains: state.memory.recentDomains.slice(0, 5),
    checkpoints,
    workflows
  };
}

function formatMemoryContext(memoryContext) {
  const lines = [];
  const preferences = memoryContext?.preferences || {};
  if (preferences.preferredModel) {
    lines.push(`Assistant preferences: model=${preferences.preferredModel} (${preferences.preferredModelCapability || "unknown"}), approval=${preferences.approvalMode || "auto"}, maxIterations=${preferences.maxIterations || DEFAULT_SETTINGS.maxIterations}.`);
  }

  if (memoryContext?.activeGoal?.task) {
    lines.push(`Active goal memory: ${memoryContext.activeGoal.task} [${memoryContext.activeGoal.status}]${memoryContext.activeGoal.currentStepObjective ? `; current checkpoint: ${memoryContext.activeGoal.currentStepObjective}` : ""}.`);
  }

  if (memoryContext?.checkpoints?.length) {
    lines.push(`Relevant checkpoints: ${memoryContext.checkpoints.map((entry) => `${truncate(entry.task, 80)} [${entry.status}]${entry.currentStepObjective ? ` at ${truncate(entry.currentStepObjective, 80)}` : ""}`).join(" | ")}.`);
  }

  if (memoryContext?.workflows?.length) {
    lines.push(`Known workflows: ${memoryContext.workflows.map((entry) => `${entry.taskSnippet}${entry.domain ? ` on ${entry.domain}` : ""} (successes: ${entry.successCount || 0}/${entry.runCount || 0})`).join(" | ")}.`);
  }

  if (memoryContext?.recentDomains?.length) {
    lines.push(`Recent domains: ${memoryContext.recentDomains.map((entry) => `${entry.domain} (${entry.visits || 0} visits)`).join(", ")}.`);
  }

  return lines.length ? lines.join("\n") : "No durable memory stored yet.";
}

function extractMemoryDomain(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (!/^https?:$/i.test(parsed.protocol)) {
      return "";
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

function buildTaskFingerprint(task) {
  return String(task || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .filter((token, index, entries) => entries.indexOf(token) === index)
    .slice(0, MEMORY_TASK_TOKEN_LIMIT)
    .join(" ");
}

function taskFingerprintsOverlap(left, right) {
  const leftTokens = new Set(buildTaskFingerprint(left).split(/\s+/).filter(Boolean));
  const rightTokens = new Set(buildTaskFingerprint(right).split(/\s+/).filter(Boolean));
  const overlap = countFingerprintSetOverlap(leftTokens, rightTokens);
  return overlap >= Math.min(2, leftTokens.size, rightTokens.size);
}

function countTaskFingerprintOverlap(left, right) {
  const leftTokens = new Set(buildTaskFingerprint(left).split(/\s+/).filter(Boolean));
  const rightTokens = new Set(buildTaskFingerprint(right).split(/\s+/).filter(Boolean));
  return countFingerprintSetOverlap(leftTokens, rightTokens);
}

function countFingerprintSetOverlap(leftTokens, rightTokens) {
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
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
  renderTelemetry();
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

function updateAddressMeta(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === START_PAGE_DISPLAY_URL || trimmed === START_PAGE_URL) {
    elements.addressChip.textContent = "Start";
    elements.addressStatus.textContent = "Jump to the local start page or type a destination.";
    return;
  }

  if (isLikelyUrlQuery(trimmed)) {
    elements.addressChip.textContent = "Address";
    elements.addressStatus.textContent = "Press Enter to open this destination directly.";
    return;
  }

  elements.addressChip.textContent = "Search";
  elements.addressStatus.textContent = "Press Enter to search Google from the current tab.";
}

function buildTabButtonTitle(tab) {
  const title = tab.title || "New tab";
  const url = formatDisplayUrl(tab.url || "");
  const status = tab.loading ? "Loading" : formatPageBadge(tab.url, false);
  return [title, url, status].filter(Boolean).join(" - ");
}

function formatPageBadge(url, loading) {
  if (loading) {
    return "Loading";
  }

  const kind = classifyPageBadge(url);
  switch (kind) {
    case "local":
      return "Local";
    case "secure":
      return "Secure";
    case "search":
      return "Search";
    default:
      return "Website";
  }
}

function classifyPageBadge(url) {
  const value = String(url || "");
  if (!value || value === START_PAGE_URL || value === START_PAGE_DISPLAY_URL || value.startsWith("file://")) {
    return "local";
  }

  if (value.startsWith("https://www.google.com/search?")) {
    return "search";
  }

  if (value.startsWith("https://")) {
    return "secure";
  }

  return "web";
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

function hashString(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
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
