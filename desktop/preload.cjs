const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("founderDesk", {
  getRecentProjects: () => ipcRenderer.invoke("projects:recent"),
  selectProject: () => ipcRenderer.invoke("projects:select"),
  openRecentProject: (index) => ipcRenderer.invoke("projects:openRecent", index),
  refreshProject: () => ipcRenderer.invoke("projects:refresh"),
  initializeProject: (runtime) => ipcRenderer.invoke("projects:initialize", runtime),
  setRuntime: (runtime) => ipcRenderer.invoke("projects:setRuntime", runtime),
  startIdeaValidation: (input) => ipcRenderer.invoke("workflows:startIdeaValidation", input),
  startFeatureDelivery: (input) => ipcRenderer.invoke("workflows:startFeatureDelivery", input),
  getTaskReview: (taskId) => ipcRenderer.invoke("reviews:getTask", taskId),
  getApprovalArtifact: (approvalId) => ipcRenderer.invoke("approvals:getArtifact", approvalId),
  decideApproval: (approvalId, decision, reason) => ipcRenderer.invoke("approvals:decide", approvalId, decision, reason),
});
