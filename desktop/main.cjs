const path = require("path");
const { app, BrowserWindow, ipcMain, nativeImage, shell } = require("electron");
const { chat, listModels, testConnection } = require("./main/ollama.cjs");
const { recognizeScreenshot, shutdownPerception } = require("./main/perception.cjs");

let mainWindow;
const isMac = process.platform === "darwin";
let crashRecoveryUsed = false;
const iconPath = path.join(__dirname, "browser-shell", "assets", "electron-logo.png");

// Electron 38 has been unstable on some Macs with GPU compositing enabled.
// Disabling hardware acceleration trades a small amount of rendering performance
// for a much more reliable startup path.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");

function createMainWindow(bootMode = "normal") {
  mainWindow = new BrowserWindow({
    width: 1660,
    height: 1040,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    backgroundColor: "#e8edf5",
    title: "Electron",
    icon: iconPath,
    autoHideMenuBar: true,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "browser-shell", "index.html"), {
    query: { bootMode }
  });
  attachDiagnostics(mainWindow, bootMode);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (process.env.BROWSER_SMOKE_TEST === "1") {
    mainWindow.webContents.once("did-finish-load", () => {
      void runSmokeCheck();
    });
  }

  if (process.env.ELECTRON_OPEN_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(() => {
  applyAppIcon();
  registerIpcHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void shutdownPerception();
});

function registerIpcHandlers() {
  ipcMain.handle("app:get-info", () => ({
    name: "Electron",
    version: app.getVersion(),
    platform: process.platform
  }));

  ipcMain.handle("shell:open-external", async (_event, url) => {
    if (url) {
      await shell.openExternal(url);
    }
    return { ok: true };
  });

  ipcMain.handle("ollama:list-models", async (_event, settings) => listModels(settings));
  ipcMain.handle("ollama:test-connection", async (_event, settings) => testConnection(settings));
  ipcMain.handle("ollama:chat", async (_event, payload) => {
    const { settings, messages, tools } = payload || {};
    return chat(settings || {}, messages || [], tools || []);
  });
  ipcMain.handle("perception:ocr-screenshot", async (_event, payload) => recognizeScreenshot(payload || {}));
}

function applyAppIcon() {
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    console.warn(`[icon] Unable to load icon from ${iconPath}`);
    return;
  }

  if (isMac && app.dock?.setIcon) {
    app.dock.setIcon(icon);
  }
}

function attachDiagnostics(window, bootMode) {
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const source = sourceId || "renderer";
    console.log(`[renderer:${level}] ${message} (${source}:${line})`);
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (errorCode === -3) {
      return;
    }
    const frameType = isMainFrame ? "main-frame" : "sub-frame";
    console.error(`[load-failed:${frameType}] ${validatedURL || "unknown URL"} :: ${errorDescription} (${errorCode})`);
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[render-process-gone] reason=${details.reason} exitCode=${details.exitCode}`);
    if (process.env.BROWSER_SMOKE_TEST === "1") {
      return;
    }

    if (crashRecoveryUsed || !mainWindow || window !== mainWindow) {
      return;
    }

    crashRecoveryUsed = true;
    console.error(`[recovery] relaunching Electron in safe mode after renderer loss from ${bootMode} boot.`);
    try {
      if (!mainWindow.isDestroyed()) {
        mainWindow.destroy();
      }
    } catch {
      // Ignore cleanup failures during crash recovery.
    }
    mainWindow = null;
    setTimeout(() => createMainWindow("safe"), 400);
  });

  window.webContents.on("unresponsive", () => {
    console.error("[renderer] window became unresponsive");
  });
}

async function runSmokeCheck() {
  try {
    await waitForRendererReady(mainWindow);
    const summary = await mainWindow.webContents.executeJavaScript(`
      ({
        ready: window.__LOCAL_COMET_READY__ === true,
        title: document.title,
        hasShell: Boolean(document.querySelector(".window-shell")),
        hasTabs: Boolean(document.getElementById("tabs")),
        hasToolbar: Boolean(document.getElementById("address-form")),
        hasBrowserStack: Boolean(document.getElementById("browser-stack")),
        hasAgentPane: Boolean(document.getElementById("agent-pane")),
        hasConversation: Boolean(document.getElementById("conversation")),
        hasComposer: Boolean(document.getElementById("task-form"))
      })
    `, true);

    if (!summary.ready || !summary.hasShell || !summary.hasTabs || !summary.hasToolbar || !summary.hasBrowserStack || !summary.hasAgentPane || !summary.hasConversation || !summary.hasComposer) {
      throw new Error(`Smoke check failed: ${JSON.stringify(summary)}`);
    }

    const scrollSummary = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const pane = document.getElementById("agent-pane");
        const scrollContent = pane?.querySelector(".agent-scroll");
        const upButton = document.getElementById("agent-scroll-up-button");
        const downButton = document.getElementById("agent-scroll-down-button");
        if (!pane || !scrollContent) {
          return { ok: false, reason: "assistant rail missing" };
        }
        if (!upButton || !downButton) {
          return { ok: false, reason: "assistant scroll buttons missing" };
        }

        const filler = document.createElement("div");
        filler.style.height = "1200px";
        filler.style.flex = "0 0 auto";
        filler.dataset.smokeSpacer = "true";
        scrollContent.appendChild(filler);

        pane.scrollTop = 0;
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const startTop = pane.scrollTop;
        const scrollHeight = pane.scrollHeight;
        const clientHeight = pane.clientHeight;

        downButton.click();
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const downTop = pane.scrollTop;

        upButton.click();
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const upTop = pane.scrollTop;

        const result = {
          ok: scrollHeight > clientHeight && downTop > startTop && upTop < downTop,
          startTop,
          downTop,
          upTop,
          scrollHeight,
          clientHeight,
          hasButtons: true
        };

        filler.remove();
        pane.scrollTop = 0;
        return result;
      })()
    `, true);

    if (!scrollSummary.ok) {
      throw new Error(`Assistant rail scroll check failed: ${JSON.stringify(scrollSummary)}`);
    }

    console.log("Desktop shell loaded.");
    console.log(JSON.stringify(summary));
    console.log(JSON.stringify({ assistantScroll: scrollSummary }));
  } catch (error) {
    console.error(`Desktop shell smoke check failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    setTimeout(() => app.quit(), 500);
  }
}

async function waitForRendererReady(window, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const ready = await window.webContents.executeJavaScript("window.__LOCAL_COMET_READY__ === true", true);
      if (ready) {
        return;
      }
    } catch {
      // The renderer may not be ready to execute JS yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for the renderer to signal readiness.");
}
