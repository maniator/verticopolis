/**
 * Starts `vite preview`, waits for it to come up, runs the screenshot capture,
 * then shuts the server down. Used by `npm run screenshots`.
 *
 * The capture script defaults to scripts/screenshots.mjs (the full showcase set)
 * but can be overridden with the SHOT_SCRIPT env var to run a focused capture
 * (e.g. `SHOT_SCRIPT=scripts/shot-condo-modes.mjs`), so feature-specific shots
 * reuse the same serve/teardown.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const SHOT_SCRIPT = process.env.SHOT_SCRIPT || "scripts/screenshots.mjs";

const server = spawn("npx", ["vite", "preview", "--port", String(PORT)], {
  stdio: "inherit",
});

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

let code = 1;
try {
  if (!(await waitForServer())) throw new Error("preview server did not start");
  await new Promise((resolve, reject) => {
    const shot = spawn("node", [SHOT_SCRIPT], {
      stdio: "inherit",
      env: { ...process.env, BASE_URL: BASE },
    });
    shot.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("screenshots failed: " + c))));
  });
  code = 0;
} catch (e) {
  console.error(e.message);
} finally {
  server.kill("SIGTERM");
}
process.exit(code);
