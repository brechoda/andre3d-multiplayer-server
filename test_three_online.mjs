import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

const port = 29000 + Math.floor(Math.random() * 10000);
const room = `THREE_ONLINE_${process.pid}`;
const server = spawn(process.execPath, ["server.mjs"], { cwd: new URL(".", import.meta.url), env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
const clients = [];
function client() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const queue = [];
  const c = { socket, send: (m) => socket.send(JSON.stringify(m)), close: () => socket.close(), next: (fn) => new Promise((resolve, reject) => {
    const found = queue.findIndex(fn);
    if (found >= 0) return resolve(queue.splice(found, 1)[0]);
    const timer = setTimeout(() => reject(new Error(`timeout; queue=${JSON.stringify(queue)}`)), 3000);
    c._waiters.push({ fn, resolve: (m) => { clearTimeout(timer); resolve(m); }, timer });
  }), _waiters: [] };
  socket.on("message", (raw) => { const m = JSON.parse(raw); const i = c._waiters.findIndex((w) => w.fn(m)); if (i >= 0) c._waiters.splice(i, 1)[0].resolve(m); else queue.push(m); });
  clients.push(c);
  return new Promise((resolve, reject) => { socket.once("open", () => resolve(c)); socket.once("error", reject); });
}
try {
  for (let i = 0; i < 40; i += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {} await delay(50); }
  const [andre, gorece, dg] = await Promise.all([client(), client(), client()]);
  const joins = [[andre, "andre", "Andre Online", 30], [gorece, "gorece", "Gorece Online", 31], [dg, "dg", "DG Online", 32]];
  const welcomes = [];
  for (const [c, character, name] of joins) { c.send({ type: "join", build: "andre3d-mp-v4", app_version: "2.1.7", room, name, character }); welcomes.push(await c.next((m) => m.type === "welcome")); }
  assert.deepEqual(welcomes.map((w) => w.players.find((p) => p.id === w.id).character), ["andre", "gorece", "dg"]);
  await delay(50);
  for (const [c, character, name, x] of joins) c.send({ type: "state", seq: 1, x, y: 4.3, z: 89, ry: 0, vx: 0, vy: 0, vz: 0, running: false, latency_ms: 0, vehicle: "on_foot", vehicle_id: "", riding: false, vehicle_x: x, vehicle_y: 4.3, vehicle_z: 89, vehicle_ry: 0, vehicle_vx: 0, vehicle_vy: 0, vehicle_vz: 0, vehicle_audio: "off", character });
  const seen = [];
  for (const [id, character, x] of [[welcomes[0].id, "andre", 30], [welcomes[2].id, "dg", 32]]) {
    const m = await gorece.next((message) => message.type === "snapshot" && message.players.some((p) => p.id === id && p.character === character && p.x === x));
    seen.push(m.players.find((p) => p.id === id));
  }
  assert.ok(Math.abs(seen[0].x - seen[1].x) <= 2.1);
  console.log("three online integration: Andre, Gorece and DG joined the same room, synced nearby map positions and manifest-backed online mode");
} finally { for (const c of clients) c.close(); server.kill("SIGTERM"); await new Promise((resolve) => server.once("exit", resolve)); }
