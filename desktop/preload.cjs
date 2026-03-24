const { contextBridge, ipcRenderer } = require("electron");

async function invokeBridge(channel, payload) {
  const response = await ipcRenderer.invoke(channel, payload);
  if (response?.ok === false) {
    throw new Error(String(response.error || `IPC request failed for ${channel}.`));
  }
  if (response && Object.prototype.hasOwnProperty.call(response, "data")) {
    return response.data;
  }
  return response;
}

contextBridge.exposeInMainWorld("desktopBridge", {
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  listModels: (settings) => invokeBridge("ollama:list-models", settings),
  testConnection: (settings) => invokeBridge("ollama:test-connection", settings),
  chatWithOllama: (payload) => invokeBridge("ollama:chat", payload),
  ocrScreenshot: (payload) => ipcRenderer.invoke("perception:ocr-screenshot", payload)
});
