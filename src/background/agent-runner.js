import { executeBrowserTool, describeToolUse, isSensitiveAction } from "./browser-tools.js";
import { chatWithOllama } from "./ollama-client.js";
import { BROWSER_TOOLS } from "../shared/tool-schema.js";
import { MUTATING_TOOLS, SYSTEM_PROMPT, ERROR_CATEGORIES } from "../shared/constants.js";
import { appendAuditEntry } from "../shared/storage.js";

export async function runAgentTask({ task, settings, initialTabId, controls }) {
  let currentTabId = initialTabId;
  const taskId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `Task: ${task}`,
        "You are operating a real browser.",
        "Use inspect_page early, then take deliberate actions until the task is done.",
        "Always verify the result of each action before proceeding to the next step."
      ].join("\n")
    }
  ];

  controls.log("info", `Starting task on tab ${initialTabId}.`);
  controls.setStep?.({ step: 0, total: settings.maxIterations, phase: "starting" });

  await appendAuditEntry({
    taskId,
    type: "task_start",
    task,
    tabId: initialTabId
  });

  for (let step = 1; step <= settings.maxIterations; step += 1) {
    ensureNotCancelled(controls);
    controls.log("info", `Agent step ${step}/${settings.maxIterations}`);
    controls.setStep?.({
      step,
      total: settings.maxIterations,
      phase: "thinking"
    });

    let response;
    try {
      response = await chatWithOllama({
        settings,
        messages,
        tools: BROWSER_TOOLS
      });
    } catch (error) {
      const category = error.category || ERROR_CATEGORIES.NETWORK;
      controls.log("error", `${categoryLabel(category)}: ${error.message}`);

      if (error.diagnostics) {
        for (const hint of error.diagnostics) {
          controls.log("info", `💡 ${hint}`);
        }
      }

      await appendAuditEntry({
        taskId,
        type: "model_error",
        step,
        category,
        error: error.message
      });

      throw error;
    }

    const assistantMessage = normalizeAssistantMessage(response.message);
    messages.push(assistantMessage);

    const reasoningSummary = buildReasoningSummary(assistantMessage);
    if (reasoningSummary) {
      controls.log("reasoning", reasoningSummary);
    }

    if (assistantMessage.content) {
      controls.log("assistant", assistantMessage.content);
    }

    const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];
    if (!toolCalls.length) {
      if (!assistantMessage.content) {
        throw new Error("The model returned neither content nor tool calls.");
      }

      controls.setStep?.({ step, total: settings.maxIterations, phase: "completed" });

      await appendAuditEntry({
        taskId,
        type: "task_complete",
        step,
        summary: assistantMessage.content
      });

      return {
        ok: true,
        summary: assistantMessage.content,
        currentTabId
      };
    }

    for (const toolCall of toolCalls) {
      ensureNotCancelled(controls);
      const name = toolCall?.function?.name;
      const args = normalizeArguments(toolCall?.function?.arguments);
      if (!name) {
        continue;
      }

      const description = describeToolUse(name, args);
      controls.log("tool", `Tool: ${name}`);
      controls.setStep?.({
        step,
        total: settings.maxIterations,
        phase: "acting",
        toolName: name,
        toolDescription: description
      });

      const needsApproval = shouldRequireApproval(name, args, settings);

      if (needsApproval) {
        const approved = await controls.requestApproval({
          toolName: name,
          description,
          isSensitive: isSensitiveAction(name, args)
        });

        if (!approved) {
          const deniedResult = {
            ok: false,
            error: "Action denied by user."
          };
          messages.push({
            role: "tool",
            tool_name: name,
            content: JSON.stringify(deniedResult)
          });
          controls.log("warn", `Denied ${name}.`);

          await appendAuditEntry({
            taskId,
            type: "action_denied",
            step,
            tool: name,
            args: sanitizeArgs(args)
          });

          continue;
        }
      }

      let result;
      try {
        result = await executeBrowserTool({
          name,
          args,
          currentTabId,
          settings
        });
      } catch (error) {
        result = {
          ok: false,
          error: error.message,
          errorCategory: classifyToolError(error)
        };
      }

      if (result.currentTabId) {
        currentTabId = result.currentTabId;
        controls.setCurrentTabId?.(currentTabId);
      }

      messages.push({
        role: "tool",
        tool_name: name,
        content: JSON.stringify(result)
      });

      const logLevel = result.ok === false ? "error" : "tool";
      controls.log(logLevel, summarizeToolResult(name, result));

      await appendAuditEntry({
        taskId,
        type: "tool_executed",
        step,
        tool: name,
        args: sanitizeArgs(args),
        ok: result.ok !== false,
        summary: result.summary || result.error || ""
      });
    }
  }

  await appendAuditEntry({
    taskId,
    type: "task_timeout",
    maxIterations: settings.maxIterations
  });

  throw new Error(`Stopped after ${settings.maxIterations} steps without a final answer.`);
}

function shouldRequireApproval(name, args, settings) {
  if (!MUTATING_TOOLS.has(name)) {
    return false;
  }

  if (settings.approvalMode === "manual") {
    return true;
  }

  if (settings.sensitiveActionWarnings && isSensitiveAction(name, args)) {
    return true;
  }

  return false;
}

function normalizeAssistantMessage(message = {}) {
  return {
    role: "assistant",
    content: String(message.content || "").trim(),
    tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : []
  };
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

    if (!steps.length) {
      return "Decision trace: preparing the next browser action.";
    }

    const summary = steps.join(", then ");
    return `Decision trace: next I will ${summary}.`;
  }

  if (message.content) {
    return "Decision trace: I have enough information to answer without another browser action.";
  }

  return "";
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

function summarizeToolResult(name, result) {
  if (result.summary) {
    return `${name}: ${result.summary}`;
  }

  if (result.error) {
    return `${name} failed: ${result.error}`;
  }

  return `${name}: completed.`;
}

function classifyToolError(error) {
  const message = (error.message || "").toLowerCase();
  if (message.includes("not found") || message.includes("no longer exists")) {
    return ERROR_CATEGORIES.DOM;
  }
  if (message.includes("blocked") || message.includes("allowlist")) {
    return ERROR_CATEGORIES.PERMISSION;
  }
  if (message.includes("cannot control") || message.includes("restricted")) {
    return ERROR_CATEGORIES.PERMISSION;
  }
  return ERROR_CATEGORIES.DOM;
}

function categoryLabel(category) {
  switch (category) {
    case ERROR_CATEGORIES.AUTH:
      return "🔐 Authentication error";
    case ERROR_CATEGORIES.CORS:
      return "🚫 CORS blocked (run ./setup.sh)";
    case ERROR_CATEGORIES.MODEL:
      return "🤖 Model error";
    case ERROR_CATEGORIES.NETWORK:
      return "🌐 Network error";
    case ERROR_CATEGORIES.TIMEOUT:
      return "⏱️ Timeout";
    case ERROR_CATEGORIES.DOM:
      return "🖱️ DOM error";
    case ERROR_CATEGORIES.PERMISSION:
      return "🚫 Permission error";
    default:
      return "❌ Error";
  }
}

function sanitizeArgs(args) {
  const clean = { ...args };
  if (clean.text && clean.text.length > 200) {
    clean.text = clean.text.slice(0, 200) + "...";
  }
  return clean;
}

function ensureNotCancelled(controls) {
  if (controls.isCancelled()) {
    throw new Error("Task stopped.");
  }
}
