import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import puppeteer from "puppeteer-core";

const EXTENSION_ROOT = process.cwd();
const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TEST_PORT = 3210;
const OLLAMA_PORT = Number.parseInt(process.env.VERIFY_OLLAMA_PORT || "11434", 10);
const USE_REAL_OLLAMA = process.argv.includes("--real-ollama");
const VERIFY_MODEL = process.env.VERIFY_MODEL || "qwen3:latest";
const TASK_TEXT = USE_REAL_OLLAMA
  ? 'You are on a page titled Browser Control Verification. First inspect the page. Then type exactly "hello browser" into the input field labeled Verification text and click the Apply button.'
  : 'Type "hello browser" into the test field and click the Apply button.';

let browser;
let testServer;
let ollamaServer;
let userDataDir;

try {
  console.log("Verifier: checking Chrome.");
  await assertChromeInstalled();
  console.log(`Verifier: starting test page on ${TEST_PORT}.`);
  testServer = await startServer(TEST_PORT, handleTestPageRequest);
  if (!USE_REAL_OLLAMA) {
    console.log(`Verifier: starting fake Ollama backend on ${OLLAMA_PORT}.`);
    ollamaServer = await startServer(OLLAMA_PORT, handleFakeOllamaRequest);
  }
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ollama-browser-control-"));
  console.log(`Verifier: launching Chrome with temp profile ${userDataDir}.`);

  browser = await puppeteer.launch({
    executablePath: CHROME_EXECUTABLE,
    headless: false,
    pipe: true,
    userDataDir,
    enableExtensions: [EXTENSION_ROOT],
    args: [
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  const serviceWorkerTarget = await browser.waitForTarget(
    (target) => target.type() === "service_worker" && target.url().startsWith("chrome-extension://"),
    { timeout: 15000 }
  );
  const extensionId = new URL(serviceWorkerTarget.url()).host;
  console.log(`Loaded extension ${extensionId}`);

  const extensionPage = await browser.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/src/options/options.html`, {
    waitUntil: "networkidle0"
  });

  await extensionPage.evaluate(async (baseUrl, modelName, maxIterations, requestTimeoutMs) => {
    const response = await chrome.runtime.sendMessage({
      type: "saveSettings",
      settings: {
        baseUrl,
        apiKey: "",
        model: modelName,
        approvalMode: "auto",
        allowedOrigins: `http://127.0.0.1:${3210}`,
        maxIterations: maxIterations,
        temperature: 0.1,
        requestTimeoutMs: requestTimeoutMs,
        keepAlive: "10m"
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to save extension settings.");
    }
  }, `http://127.0.0.1:${OLLAMA_PORT}`, VERIFY_MODEL, USE_REAL_OLLAMA ? 12 : 6, USE_REAL_OLLAMA ? 180000 : 30000);

  const listModelsResult = await extensionPage.evaluate(async () => {
    return chrome.runtime.sendMessage({ type: "listModels" });
  });

  const listedModelNames = Array.isArray(listModelsResult?.models)
    ? listModelsResult.models.map((model) => typeof model === "string" ? model : model.name)
    : [];

  if (!listModelsResult?.ok || !listedModelNames.includes(VERIFY_MODEL)) {
    throw new Error(`Expected model list to include ${VERIFY_MODEL}. Received: ${JSON.stringify(listModelsResult)}`);
  }

  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${TEST_PORT}/`, { waitUntil: "networkidle0" });
  await page.bringToFront();
  console.log("Verifier: opened the browser control test page.");

  const runResult = await extensionPage.evaluate(async (task, urlPattern) => {
    const tabs = await chrome.tabs.query({ url: urlPattern });
    const targetTab = tabs.find((tab) => tab.url?.startsWith("http://127.0.0.1:3210/"));
    if (!targetTab?.id) {
      throw new Error("Could not locate the test page tab.");
    }

    return chrome.runtime.sendMessage({
      type: "startTaskWithTab",
      task,
      tabId: targetTab.id
    });
  }, TASK_TEXT, `http://127.0.0.1:${TEST_PORT}/*`);

  if (!runResult?.ok) {
    throw new Error(`Task launch failed: ${JSON.stringify(runResult)}`);
  }
  console.log("Verifier: task started, waiting for completion.");

  const runtimeState = await waitForTaskToFinish(extensionPage, USE_REAL_OLLAMA ? 180000 : 30000);

  const logs = runtimeState?.state?.logs || [];
  const logSummary = logs.map((entry) => `[${entry.level}] ${entry.message}`).join("\n");
  const hasSuccessLog = logs.some((entry) => entry.level === "success");
  if (!hasSuccessLog) {
    throw new Error(`Task completed without a success log.\n${logSummary}`);
  }

  await page.waitForFunction(() => {
    const result = document.querySelector("#result");
    const input = document.querySelector("#browser-input");
    const appliedCount = document.body.getAttribute("data-apply-count");
    const cursor = document.querySelector("#oa-agent-cursor");
    return (
      result?.textContent === "Applied: hello browser" &&
      input?.value === "hello browser" &&
      appliedCount === "1" &&
      cursor &&
      getComputedStyle(cursor).opacity !== "0"
    );
  }, { timeout: 10000 });

  console.log("Browser control verified.");
  console.log(logSummary);
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
  if (testServer) {
    await closeServer(testServer);
  }
  if (ollamaServer) {
    await closeServer(ollamaServer);
  }
  if (userDataDir) {
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function assertChromeInstalled() {
  try {
    await fs.access(CHROME_EXECUTABLE);
  } catch {
    throw new Error(`Google Chrome not found at ${CHROME_EXECUTABLE}`);
  }
}

function startServer(port, handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function waitForTaskToFinish(extensionPage, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const runtimeState = await extensionPage.evaluate(async () => {
      return chrome.runtime.sendMessage({ type: "getRuntimeState" });
    });

    if (!runtimeState?.state?.running) {
      return runtimeState;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const runtimeState = await extensionPage.evaluate(async () => {
    return chrome.runtime.sendMessage({ type: "getRuntimeState" });
  });
  const logs = runtimeState?.state?.logs || [];
  const logSummary = logs.map((entry) => `[${entry.level}] ${entry.message}`).join("\n");
  throw new Error(`Timed out waiting for task to finish.\n${logSummary}`);
}

function handleTestPageRequest(request, response) {
  if (request.url !== "/") {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Browser Control Verification</title>
      <style>
        body { font-family: sans-serif; margin: 40px; }
        main { max-width: 720px; }
        label, button, input { font-size: 16px; }
        input { display: block; width: 100%; max-width: 360px; padding: 10px; margin: 8px 0 16px; }
        button { padding: 10px 14px; }
        #result { margin-top: 24px; font-weight: 700; }
      </style>
    </head>
    <body data-apply-count="0">
      <main>
        <h1>Browser Control Verification</h1>
        <p>This page is used to verify the extension can inspect, type, and click.</p>
        <label for="browser-input">Verification text</label>
        <input id="browser-input" name="browser_input" type="text" placeholder="Type here">
        <button id="apply-button" type="button">Apply</button>
        <p id="result">Pending</p>
      </main>
      <script>
        document.querySelector("#apply-button").addEventListener("click", () => {
          const input = document.querySelector("#browser-input");
          const result = document.querySelector("#result");
          const count = Number(document.body.getAttribute("data-apply-count") || "0") + 1;
          document.body.setAttribute("data-apply-count", String(count));
          result.textContent = "Applied: " + input.value;
        });
      </script>
    </body>
  </html>`);
}

async function handleFakeOllamaRequest(request, response) {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/api/tags") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      models: [{ name: "qwen3:latest" }]
    }));
    return;
  }

  if (request.method === "POST" && request.url === "/api/chat") {
    const body = await readJsonBody(request);
    const message = createFakeModelReply(body.messages || []);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      model: "qwen3:latest",
      created_at: new Date().toISOString(),
      done: true,
      message
    }));
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function createFakeModelReply(messages) {
  const toolMessages = messages.filter((message) => message.role === "tool");
  const clickResult = toolMessages.find((message) => message.tool_name === "click_element");
  if (clickResult) {
    return {
      role: "assistant",
      content: "Task complete. The text was entered and the button was clicked."
    };
  }

  const inspectResult = [...toolMessages].reverse().find((message) => message.tool_name === "inspect_page");
  if (!inspectResult) {
    return {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          function: {
            name: "inspect_page",
            arguments: {
              includeText: true,
              includeMetadata: true
            }
          }
        }
      ]
    };
  }

  const parsedResult = JSON.parse(inspectResult.content || "{}");
  const interactiveElements = parsedResult.page?.interactiveElements || [];
  const input = interactiveElements.find((element) => element.tag === "input" && element.name === "browser_input");
  const button = interactiveElements.find((element) => element.tag === "button" && /apply/i.test(element.text || ""));

  if (!input?.id || !button?.id) {
    throw new Error(`Fake model could not find the expected page controls. Interactive elements: ${JSON.stringify(interactiveElements)}`);
  }

  return {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        function: {
          name: "type_into_element",
          arguments: {
            elementId: input.id,
            text: "hello browser",
            clearFirst: true
          }
        }
      },
      {
        function: {
          name: "click_element",
          arguments: {
            elementId: button.id
          }
        }
      }
    ]
  };
}
