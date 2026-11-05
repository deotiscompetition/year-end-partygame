// 로컬 개발: Worker와 Next를 함께 띄웁니다.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
// meilian-wedding(3000·8787)과 함께 띄울 수 있도록 포트를 나눕니다.
const port = Number(process.env.PORT ?? 3100);
const apiPort = Number(process.env.GAME_API_PORT ?? 8797);
const adminPassword = process.env.ADMIN_PASSWORD ?? "local-admin";

const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  process.exitCode = code;
}
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());

function start(entry, args, env = {}) {
  const child = spawn(process.execPath, [entry, ...args], { stdio: "inherit", env: { ...process.env, ...env } });
  children.add(child);
  child.once("exit", code => { children.delete(child); if (!stopping) stop(code ?? 1); });
}

mkdirSync(".tmp/dev-assets", { recursive: true });
const wranglerPackage = require.resolve("wrangler/package.json");
const wranglerBin = resolve(dirname(wranglerPackage), JSON.parse(readFileSync(wranglerPackage, "utf8")).bin.wrangler);
start(wranglerBin, ["dev", "--local", "--ip", "0.0.0.0", "--port", String(apiPort), "--inspector-port", "0", "--assets", ".tmp/dev-assets",
  "--var", "ENVIRONMENT:local", "--var", `ADMIN_PASSWORD:${adminPassword}`]);

let ready = false;
for (let attempt = 0; attempt < 100 && !stopping && !ready; attempt++) {
  try {
    ready = (await fetch(`http://127.0.0.1:${apiPort}/api/ready`, { signal: AbortSignal.timeout(500) })).ok;
  } catch {}
  if (!ready) await delay(300);
}
if (!ready) {
  console.error("Worker를 시작하지 못했습니다.");
  stop(1);
} else {
  console.log(`로컬 관리자 비밀번호: ${adminPassword} (로컬 전용, ADMIN_PASSWORD로 변경 가능)`);
  start(require.resolve("next/dist/bin/next"), ["dev", "--webpack", "--hostname", "0.0.0.0", "--port", String(port)], {
    GAME_API_PORT: String(apiPort), NEXT_PUBLIC_GAME_API_PORT: String(apiPort),
  });
}
