import { spawn } from "node:child_process";
import electron from "electron";

const child = spawn(electron, ["desktop/main.cjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    BROWSER_SMOKE_TEST: "1"
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
