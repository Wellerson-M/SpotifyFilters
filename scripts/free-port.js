const { execSync } = require("node:child_process");
const os = require("node:os");

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    return "";
  }
}

function freePortWindows(port) {
  const output = run("netstat -ano -p tcp");
  const lines = output.split(/\r?\n/);
  const pids = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.includes(`:${port}`)) continue;
    if (!trimmed.includes("LISTENING")) continue;
    const cols = trimmed.split(/\s+/);
    const pid = cols[cols.length - 1];
    if (/^\d+$/.test(pid)) {
      pids.add(pid);
    }
  }

  for (const pid of pids) {
    run(`taskkill /PID ${pid} /F`);
  }
}

function freePortUnix(port) {
  const output = run(`lsof -ti tcp:${port}`);
  const pids = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));

  for (const pid of pids) {
    run(`kill -9 ${pid}`);
  }
}

const portArg = process.argv[2];
const port = Number(portArg || "3001");
if (!Number.isFinite(port) || port <= 0) {
  process.exit(0);
}

if (os.platform() === "win32") {
  freePortWindows(port);
} else {
  freePortUnix(port);
}
