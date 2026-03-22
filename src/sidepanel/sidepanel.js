const port = chrome.runtime.connect({ name: "sidepanel" });
let currentState = null;

const elements = {
  taskForm: document.getElementById("task-form"),
  taskInput: document.getElementById("task-input"),
  startButton: document.getElementById("start-button"),
  stopButton: document.getElementById("stop-button"),
  statusPill: document.getElementById("status-pill"),
  statusCopy: document.getElementById("status-copy"),
  stepIndicator: document.getElementById("step-indicator"),
  progressBar: document.getElementById("progress-bar"),
  progressFill: document.getElementById("progress-fill"),
  logs: document.getElementById("logs"),
  refreshButton: document.getElementById("refresh-button"),
  clearLogs: document.getElementById("clear-logs"),
  openOptions: document.getElementById("open-options"),
  approvalCard: document.getElementById("approval-card"),
  approvalSensitivity: document.getElementById("approval-sensitivity"),
  approvalTitle: document.getElementById("approval-title"),
  approvalCopy: document.getElementById("approval-copy"),
  approveButton: document.getElementById("approve-button"),
  denyButton: document.getElementById("deny-button"),
  statusCard: document.getElementById("status-card")
};

port.onMessage.addListener((message) => {
  if (message.type === "state") {
    currentState = message.state;
    renderState(currentState);
  }
});

elements.taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const task = elements.taskInput.value.trim();
  if (!task) return;
  port.postMessage({
    type: "startTask",
    task
  });
});

elements.stopButton.addEventListener("click", () => {
  port.postMessage({ type: "stopTask" });
});

elements.refreshButton.addEventListener("click", () => {
  port.postMessage({ type: "getState" });
});

elements.clearLogs.addEventListener("click", () => {
  port.postMessage({ type: "clearLogs" });
});

elements.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

elements.approveButton.addEventListener("click", () => {
  if (!currentState?.pendingApproval) {
    return;
  }

  port.postMessage({
    type: "approveAction",
    approvalId: currentState.pendingApproval.approvalId,
    approved: true
  });
});

elements.denyButton.addEventListener("click", () => {
  if (!currentState?.pendingApproval) {
    return;
  }

  port.postMessage({
    type: "approveAction",
    approvalId: currentState.pendingApproval.approvalId,
    approved: false
  });
});

elements.taskInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    elements.taskForm.requestSubmit();
  }
});

port.postMessage({ type: "getState" });

function renderState(state) {
  const running = state.running === true;

  elements.startButton.disabled = running;
  elements.stopButton.disabled = !running;

  const pillDot = elements.statusPill.querySelector(".status-dot");
  if (running) {
    elements.statusPill.className = "status-pill running";
    elements.statusPill.innerHTML = "";
    const dot = document.createElement("span");
    dot.className = "status-dot";
    elements.statusPill.appendChild(dot);
    elements.statusPill.appendChild(document.createTextNode("Running"));
  } else {
    elements.statusPill.className = "status-pill idle";
    elements.statusPill.innerHTML = "";
    const dot = document.createElement("span");
    dot.className = "status-dot";
    elements.statusPill.appendChild(dot);
    elements.statusPill.appendChild(document.createTextNode("Idle"));
  }

  elements.statusCopy.textContent = running
    ? state.currentTask || "Working through the current task."
    : state.lastResult || "Ready for a task.";

  if (state.currentStep && running) {
    const step = state.currentStep;
    elements.stepIndicator.classList.remove("hidden");
    elements.stepIndicator.textContent = `Step ${step.step}/${step.total}`;

    if (step.toolName) {
      elements.stepIndicator.textContent += ` · ${step.toolName}`;
    }

    elements.progressBar.classList.remove("hidden");
    const progress = Math.min(100, Math.round((step.step / step.total) * 100));
    elements.progressFill.style.width = `${progress}%`;
  } else {
    elements.stepIndicator.classList.add("hidden");
    elements.progressBar.classList.add("hidden");
    elements.progressFill.style.width = "0%";
  }

  if (state.pendingApproval) {
    elements.approvalCard.classList.remove("hidden");
    elements.approvalTitle.textContent = state.pendingApproval.toolName;
    elements.approvalCopy.textContent = state.pendingApproval.description;

    if (state.pendingApproval.isSensitive) {
      elements.approvalCard.classList.add("sensitive");
      elements.approvalSensitivity.textContent = "⚠️ Sensitive Action";
    } else {
      elements.approvalCard.classList.remove("sensitive");
      elements.approvalSensitivity.textContent = "Approval Needed";
    }
  } else {
    elements.approvalCard.classList.add("hidden");
  }

  renderLogs(state.logs || []);
}

function renderLogs(logs) {
  elements.logs.textContent = "";

  if (!logs.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.innerHTML = `
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      <p>No activity yet. Run a task to get started.</p>
    `;
    elements.logs.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const entry of logs.slice().reverse()) {
    const item = document.createElement("li");
    item.className = `log-item ${entry.level || "info"}`;

    const meta = document.createElement("div");
    meta.className = "log-meta";
    meta.textContent = `${levelIcon(entry.level)} ${entry.level || "info"} · ${formatTime(entry.timestamp)}`;

    const content = document.createElement("div");
    content.className = "log-content";
    content.textContent = entry.message || "";

    item.append(meta, content);
    fragment.appendChild(item);
  }

  elements.logs.appendChild(fragment);
}

function levelIcon(level) {
  switch (level) {
    case "success": return "✓";
    case "error": return "✕";
    case "warn": return "⚠";
    case "tool": return "⚙";
    case "reasoning": return "🧭";
    case "assistant": return "◆";
    default: return "›";
  }
}

function formatTime(isoString) {
  try {
    return new Date(isoString).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return "";
  }
}
