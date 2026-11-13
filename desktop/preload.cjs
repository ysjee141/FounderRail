const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("founderDesk", {
  getRecentProjects: () => ipcRenderer.invoke("projects:recent"),
  selectProject: () => ipcRenderer.invoke("projects:select"),
  openRecentProject: (index) => ipcRenderer.invoke("projects:openRecent", index),
  refreshProject: () => ipcRenderer.invoke("projects:refresh"),
  initializeProject: (runtime) => ipcRenderer.invoke("projects:initialize", runtime),
  setRuntime: (runtime) => ipcRenderer.invoke("projects:setRuntime", runtime),
  startIdeaValidation: (input) => ipcRenderer.invoke("workflows:startIdeaValidation", input),
});
