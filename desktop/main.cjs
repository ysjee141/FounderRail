const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { mkdir, readFile, realpath, rename, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const appRoot = path.resolve(__dirname, "..");
const harnessRoot = app.isPackaged ? `${appRoot}.unpacked` : appRoot;
const rendererFile = path.join(__dirname, "renderer", "index.html");
const runtimeNames = new Set(["claude", "codex", "gemini"]);
let mainWindow;
let activeProjectRoot = null;
let desktopServices;

function assertTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("Request rejected: unknown desktop window.");
  }
}

function service() {
  if (!desktopServices) {
    const serviceUrl = pathToFileURL(path.join(appRoot, "dist", "desktop", "application.js"));
    desktopServices = import(serviceUrl.href);
  }
  return desktopServices;
}

function recentProjectsFile() {
  return path.join(app.getPath("userData"), "recent-projects.json");
}

async function readRecentProjects() {
  try {
    const value = JSON.parse(await readFile(recentProjectsFile(), "utf8"));
    if (!Array.isArray(value)) return [];
    const entries = value.filter((item) => typeof item === "string");
    const available = await Promise.all(entries.map(async (item) => {
      try {
        const root = await realpath(item);
        return (await stat(root)).isDirectory() ? root : null;
      } catch {
        return null;
      }
    }));
    return [...new Set(available.filter(Boolean))].slice(0, 8);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeRecentProjects(projects) {
  const target = recentProjectsFile();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(projects.slice(0, 8), null, 2)}\n`, { flag: "w" });
  await rename(temporary, target);
}

async function includeCommonCliPaths() {
  const home = app.getPath("home");
  const candidates = process.platform === "win32"
    ? [path.join(home, ".local", "bin"), path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "npm")]
    : process.platform === "darwin"
      ? [path.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"]
      : [path.join(home, ".local", "bin"), "/usr/local/bin", "/snap/bin"];
  const current = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const known = new Set(current.map((entry) => process.platform === "win32" ? path.resolve(entry).toLowerCase() : path.resolve(entry)));
  for (const candidate of candidates) {
    try {
      if (!(await stat(candidate)).isDirectory()) continue;
      const normalized = process.platform === "win32" ? path.resolve(candidate).toLowerCase() : path.resolve(candidate);
      if (!known.has(normalized)) {
        current.push(candidate);
        known.add(normalized);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  process.env.PATH = current.join(path.delimiter);
}

async function rememberProject(root) {
  const projects = await readRecentProjects();
  await writeRecentProjects([root, ...projects.filter((item) => item !== root)]);
}

async function inspectActiveProject() {
  if (!activeProjectRoot) throw new Error("Open a project folder first.");
  return (await service()).inspectDesktopProject(activeProjectRoot, harnessRoot);
}

function registerIpc() {
  ipcMain.handle("projects:recent", async (event) => {
    assertTrustedSender(event);
    return readRecentProjects();
  });

  ipcMain.handle("projects:select", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open a project folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    activeProjectRoot = await realpath(result.filePaths[0]);
    await rememberProject(activeProjectRoot);
    return inspectActiveProject();
  });

  ipcMain.handle("projects:openRecent", async (event, index) => {
    assertTrustedSender(event);
    if (!Number.isInteger(index) || index < 0) throw new Error("Invalid recent project selection.");
    const projects = await readRecentProjects();
    if (index >= projects.length) throw new Error("This recent project is no longer available.");
    activeProjectRoot = projects[index];
    await rememberProject(activeProjectRoot);
    return inspectActiveProject();
  });

  ipcMain.handle("projects:refresh", async (event) => {
    assertTrustedSender(event);
    return inspectActiveProject();
  });

  ipcMain.handle("projects:initialize", async (event, runtime) => {
    assertTrustedSender(event);
    if (!runtimeNames.has(runtime)) throw new Error("Select Codex, Claude Code, or Gemini CLI.");
    if (!activeProjectRoot) throw new Error("Open a project folder first.");
    return (await service()).initializeDesktopProject(activeProjectRoot, harnessRoot, runtime);
  });

  ipcMain.handle("projects:setRuntime", async (event, runtime) => {
    assertTrustedSender(event);
    if (!runtimeNames.has(runtime)) throw new Error("Select Codex, Claude Code, or Gemini CLI.");
    if (!activeProjectRoot) throw new Error("Open a project folder first.");
    return (await service()).setDesktopRuntime(activeProjectRoot, harnessRoot, runtime);
  });

  ipcMain.handle("workflows:startIdeaValidation", async (event, input) => {
    assertTrustedSender(event);
    if (!activeProjectRoot) throw new Error("Open a project folder first.");
    return (await service()).startDesktopIdeaValidation(activeProjectRoot, harnessRoot, input);
  });

  ipcMain.handle("workflows:startFeatureDelivery", async (event, input) => {
    assertTrustedSender(event);
    if (!activeProjectRoot) throw new Error("Open a project folder first.");
    return (await service()).startDesktopFeatureDelivery(activeProjectRoot, harnessRoot, input);
  });

  ipcMain.handle("reviews:getTask", async (event, taskId) => {
    assertTrustedSender(event);
    if (!activeProjectRoot) throw new Error("Open a project folder first.");
    if (typeof taskId !== "string" || !/^TASK-[A-Z0-9-]+$/.test(taskId)) throw new Error("Invalid Task id.");
    return (await service()).getDesktopTaskReview(activeProjectRoot, taskId);
  });

  ipcMain.handle("approvals:getArtifact", async (event, approvalId) => {
    assertTrustedSender(event);
    if (!activeProjectRoot) throw new Error("Open a project folder first.");
    if (typeof approvalId !== "string" || !/^APPROVAL-[A-Z0-9-]+$/.test(approvalId)) throw new Error("Invalid approval id.");
    return (await service()).getDesktopApprovalArtifact(activeProjectRoot, approvalId);
  });

  ipcMain.handle("approvals:decide", async (event, approvalId, decision, reason) => {
    assertTrustedSender(event);
    if (!activeProjectRoot) throw new Error("Open a project folder first.");
    if (typeof approvalId !== "string" || !/^APPROVAL-[A-Z0-9-]+$/.test(approvalId)) throw new Error("Invalid approval id.");
    if (decision !== "approve" && decision !== "reject") throw new Error("Choose approve or reject.");
    if (typeof reason !== "string") throw new Error("Enter a decision reason.");
    return (await service()).decideDesktopApproval(activeProjectRoot, harnessRoot, approvalId, decision, reason);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 700,
    title: "Founder Desk",
    backgroundColor: "#f4f6f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, target) => {
    const expected = pathToFileURL(rendererFile).href;
    if (target !== expected) event.preventDefault();
  });
  mainWindow.loadFile(rendererFile);
}

app.whenReady().then(async () => {
  await includeCommonCliPaths();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
