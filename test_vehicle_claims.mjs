import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

const port = 19000 + Math.floor(Math.random() * 10000);
const room = `VEHICLE_TEST_${process.pid}`;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL(".", import.meta.url),
  env: { ...process.env, PORT: String(port), BUILD: "andre3d-mp-v2" },
  stdio: ["ignore", "pipe", "pipe"],
});
const clients = [];

function openClient() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages = [];
  const waiters = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      messages.push(message);
    }
  });
  const client = {
    socket,
    send(message) { socket.send(JSON.stringify(message)); },
    next(predicate, timeoutMs = 3000) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          const currentIndex = waiters.indexOf(waiter);
          if (currentIndex >= 0) waiters.splice(currentIndex, 1);
          reject(new Error("Timed out waiting for server message"));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    close() { if (socket.readyState === WebSocket.OPEN) socket.close(); },
  };
  clients.push(client);
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(client));
    socket.once("error", reject);
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("Multiplayer server did not start");
}

try {
  await waitForServer();
  const [first, second] = await Promise.all([openClient(), openClient()]);
  for (const client of [first, second]) {
    client.send({ type: "join", build: "andre3d-mp-v2", room, name: "Tester", character: "gorece" });
    await client.next((message) => message.type === "welcome");
  }

  first.send({ type: "vehicle_claim", vehicle_id: "hilux_01" });
  assert.equal((await first.next((message) => message.type === "vehicle_claim_result")).granted, true);
  second.send({ type: "vehicle_claim", vehicle_id: "hilux_01" });
  const denied = await second.next((message) => message.type === "vehicle_claim_result");
  assert.equal(denied.granted, false);
  assert.equal(denied.reason, "OCCUPIED");

  first.send({
    type: "state", x: 2, y: 0.1, z: 3, ry: 1.2,
    vehicle: "hilux", vehicle_id: "hilux_01", riding: true,
    vehicle_x: 10, vehicle_y: 0.7, vehicle_z: 12, vehicle_ry: 1.2,
    character: "gorece",
  });
  const snapshot = await second.next((message) => message.type === "snapshot"
    && message.players.some((player) => player.riding && player.vehicle_id === "hilux_01"));
  const sharedVehicleState = snapshot.players.find((player) => player.vehicle_id === "hilux_01");
  assert.equal(sharedVehicleState.vehicle, "hilux");
  assert.equal(sharedVehicleState.vehicle_x, 10);
  assert.equal(sharedVehicleState.vehicle_z, 12);

  first.send({ type: "vehicle_release", vehicle_id: "hilux_01" });
  await delay(120);
  second.send({ type: "vehicle_claim", vehicle_id: "hilux_01" });
  assert.equal((await second.next((message) => message.type === "vehicle_claim_result")).granted, true);

  second.send({ type: "vehicle_release", vehicle_id: "hilux_01" });
  second.close();
  first.close();
  console.log("vehicle claim integration test: ok");
} finally {
  for (const client of clients) client.close();
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
}
