const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  listModels: (settings) => ipcRenderer.invoke("ollama:list-models", settings),
  testConnection: (settings) => ipcRenderer.invoke("ollama:test-connection", settings),
  chatWithOllama: (payload) => ipcRenderer.invoke("ollama:chat", payload),
  ocrScreenshot: (payload) => ipcRenderer.invoke("perception:ocr-screenshot", payload)
});
