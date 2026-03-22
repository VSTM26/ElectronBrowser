import { runAgentTask } from "./agent-runner.js";
import { listOllamaModels, testOllamaConnection } from "./ollama-client.js";
import { STATE_LIMITS } from "../shared/constants.js";
import { getSettings, saveSettings, getAuditLog, clearAuditLog, getWorkflows, saveWorkflow, deleteWorkflow } from "../shared/storage.js";

const ports = new Set();
let approvalResolver = null;

const state = {
  running: false,
  abortRequested: false,
  currentTask: "",
  currentTabId: null,
  lastResult: "",
  pendingApproval: null,
  currentStep: null,
  logs: []
};

chrome.runtime.onInstalled.addListener(async () => {
  await getSettings();
  await initializeSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeSidePanelBehavior();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidepanel") {
    return;
  }

  ports.add(port);
  port.postMessage({ type: "state", state });

  port.onMessage.addListener(async (message) => {
    switch (message.type) {
      case "getState":
        port.postMessage({ type: "state", state });
        break;
      case "startTask":
        await startTask(message.task);
        break;
      case "stopTask":
        stopTask();
        break;
      case "approveAction":
        resolveApproval(message);
        break;
      case "clearLogs":
        state.logs = [];
        broadcastState();
        break;
      default:
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    ports.delete(port);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "testConnection") {
    void (async () => {
      try {
        const settings = await getSettings();
        const result = await testOllamaConnection(settings);
        sendResponse(result);
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.type === "saveSettings") {
    void (async () => {
      try {
        const settings = await saveSettings(message.settings || {});
        sendResponse({ ok: true, settings });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.type === "getSettings") {
    void (async () => {
      const settings = await getSettings();
      sendResponse({ ok: true, settings });
    })();
    return true;
  }

  if (message.type === "getRuntimeState") {
    sendResponse({ ok: true, state });
    return false;
  }

  if (message.type === "listModels") {
    void (async () => {
      try {
        const settings = await getSettings();
        const models = await listOllamaModels(settings);
        sendResponse({ ok: true, models });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.type === "openSidePanel") {
    void (async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!activeTab?.windowId) {
          sendResponse({ ok: false, error: "No active browser window found." });
          return;
        }

        await chrome.sidePanel.open({ windowId: activeTab.windowId });
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.type === "startTaskWithTab") {
    void startTask(message.task, message.tabId).catch((error) => {
      pushLog("error", error.message);
      broadcastState();
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "getAuditLog") {
    void (async () => {
      try {
        const log = await getAuditLog();
        sendResponse({ ok: true, log });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.type === "clearAuditLog") {
    void (async () => {
      try {
        await clearAuditLog();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.type === "getWorkflows") {
    void (async () => {
      try {
        const workflows = await getWorkflows();
        sendResponse({ ok: true, workflows });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.type === "saveWorkflow") {
    void (async () => {
      try {
        const workflows = await saveWorkflow(message.workflow);
        sendResponse({ ok: true, workflows });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.type === "deleteWorkflow") {
    void (async () => {
      try {
        const workflows = await deleteWorkflow(message.workflowId);
        sendResponse({ ok: true, workflows });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  return false;
});

async function startTask(task, explicitTabId = null) {
  if (state.running) {
    pushLog("warn", "A task is already running.");
    broadcastState();
    return;
  }

  const trimmedTask = String(task || "").trim();
  if (!trimmedTask) {
    pushLog("warn", "Enter a task before starting the agent.");
    broadcastState();
    return;
  }

  const activeTab = explicitTabId
    ? await chrome.tabs.get(explicitTabId)
    : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!activeTab?.id) {
    pushLog("error", "No active tab available.");
    broadcastState();
    return;
  }

  const settings = await getSettings();
  state.running = true;
  state.abortRequested = false;
  state.currentTask = trimmedTask;
  state.currentTabId = activeTab.id;
  state.lastResult = "";
  state.pendingApproval = null;
  state.currentStep = null;
  pushLog("info", `Queued task: ${trimmedTask}`);
  broadcastState();

  try {
    const result = await runAgentTask({
      task: trimmedTask,
      settings,
      initialTabId: activeTab.id,
      controls: {
        log: pushLog,
        isCancelled: () => state.abortRequested,
        requestApproval,
        setCurrentTabId: (tabId) => {
          state.currentTabId = tabId;
          broadcastState();
        },
        setStep: (stepInfo) => {
          state.currentStep = stepInfo;
          broadcastState();
        }
      }
    });

    state.lastResult = result.summary || "";
    if (result.currentTabId) {
      state.currentTabId = result.currentTabId;
    }
    pushLog("success", result.summary || "Task completed.");
  } catch (error) {
    pushLog(state.abortRequested ? "warn" : "error", error.message);
  } finally {
    state.running = false;
    state.abortRequested = false;
    state.pendingApproval = null;
    state.currentStep = null;
    approvalResolver = null;
    broadcastState();
  }
}

function stopTask() {
  if (!state.running) {
    return;
  }

  state.abortRequested = true;
  if (approvalResolver) {
    approvalResolver(false);
    approvalResolver = null;
  }
  pushLog("warn", "Stop requested.");
  broadcastState();
}

function requestApproval({ toolName, description, isSensitive }) {
  return new Promise((resolve) => {
    const approvalId = crypto.randomUUID();
    approvalResolver = resolve;
    state.pendingApproval = {
      approvalId,
      toolName,
      description,
      isSensitive: isSensitive === true
    };
    pushLog("warn", `Approval required: ${description}`);
    broadcastState();
  });
}

function resolveApproval(message) {
  if (!state.pendingApproval || !approvalResolver) {
    return;
  }

  if (message.approvalId !== state.pendingApproval.approvalId) {
    return;
  }

  const approved = message.approved === true;
  approvalResolver(approved);
  approvalResolver = null;
  state.pendingApproval = null;
  pushLog(approved ? "info" : "warn", approved ? "Action approved." : "Action denied.");
  broadcastState();
}

function pushLog(level, message) {
  state.logs = [
    ...state.logs,
    {
      level,
      message: String(message || ""),
      timestamp: new Date().toISOString()
    }
  ].slice(-STATE_LIMITS.logs);
  broadcastState();
}

function broadcastState() {
  for (const port of ports) {
    try {
      port.postMessage({ type: "state", state });
    } catch {
      ports.delete(port);
    }
  }
}

async function initializeSidePanelBehavior() {
  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  });
}
