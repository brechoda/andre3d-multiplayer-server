import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

const port = 19000 + Math.floor(Math.random() * 10000);
const room = `VEHICLE_TEST_${process.pid}`;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL(".", import.meta.url),
  env: { ...process.env, PORT: String(port), BUILD: "andre3d-mp-v4" },
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
  const [first, second, dg] = await Promise.all([openClient(), openClient(), openClient()]);
  first.send({ type: "join", build: "andre3d-mp-v4", room, name: "Tester1", character: "gorece" });
  const firstWelcome = await first.next((message) => message.type === "welcome");
  second.send({ type: "join", build: "andre3d-mp-v4", room, name: "Tester2", character: "gorece" });
  await second.next((message) => message.type === "welcome");
  dg.send({ type: "join", build: "andre3d-mp-v4", room, name: "DG Tester", character: "dg" });
  const dgWelcome = await dg.next((message) => message.type === "welcome");
  assert.equal(dgWelcome.players.find((player) => player.id === dgWelcome.id)?.character, "dg");

  dg.send({ type: "vehicle_claim", vehicle_id: "hilux_01" });
  const hiluxDenied = await dg.next((message) => message.type === "vehicle_claim_result");
  assert.equal(hiluxDenied.granted, false);
  assert.equal(hiluxDenied.reason, "CHARACTER_CANNOT_USE_VEHICLE");
  await delay(120);
  dg.send({ type: "vehicle_claim", vehicle_id: "pop100_01" });
  assert.equal((await dg.next((message) => message.type === "vehicle_claim_result")).granted, true);
  dg.send({ type: "vehicle_release", vehicle_id: "pop100_01" });
  await delay(120);
  dg.send({
    type: "state", seq: 1, x: 1, y: 0, z: 2, ry: 0,
    vx: 0, vy: 0, vz: 0, latency_ms: 0,
    vehicle: "hilux", vehicle_id: "hilux_01", riding: true,
    vehicle_x: 1, vehicle_y: 0, vehicle_z: 2, vehicle_ry: 0,
    vehicle_vx: 0, vehicle_vy: 0, vehicle_vz: 0,
    vehicle_audio: "off", character: "dg",
  });
  const forcedHiluxDenied = await dg.next((message) => message.type === "vehicle_claim_result");
  assert.equal(forcedHiluxDenied.granted, false);
  assert.equal(forcedHiluxDenied.reason, "CHARACTER_CANNOT_USE_VEHICLE");
  const dgSnapshot = await second.next((message) => message.type === "snapshot"
    && message.players.some((player) => player.id === dgWelcome.id && player.character === "dg"));
  const dgState = dgSnapshot.players.find((player) => player.id === dgWelcome.id);
  assert.equal(dgState.character, "dg");
  assert.equal(dgState.riding, false);
  assert.equal(dgState.vehicle, "on_foot");

  first.send({ type: "jump", seq: 1 });
  const jump = await second.next((message) => message.type === "jump");
  assert.equal(jump.id, firstWelcome.id);
  assert.equal(jump.seq, 1);
  const duplicateJump = second.next((message) => message.type === "jump" && message.id === firstWelcome.id && message.seq === 1, 120);
  first.send({ type: "jump", seq: 1 });
  await assert.rejects(duplicateJump, /Timed out waiting for server message/);

  first.send({ type: "vehicle_claim", vehicle_id: "hilux_01" });
  assert.equal((await first.next((message) => message.type === "vehicle_claim_result")).granted, true);
  second.send({ type: "vehicle_claim", vehicle_id: "hilux_01" });
  const denied = await second.next((message) => message.type === "vehicle_claim_result");
  assert.equal(denied.granted, false);
  assert.equal(denied.reason, "OCCUPIED");

  const stateSentAt = performance.now();
  first.send({
    type: "state", seq: 1, x: 2, y: 0.1, z: 3, ry: 1.2,
    vx: 1.5, vy: 0, vz: -2, latency_ms: 30,
    vehicle: "hilux", vehicle_id: "hilux_01", riding: true,
    vehicle_x: 10, vehicle_y: 0.7, vehicle_z: 12, vehicle_ry: 1.2,
    vehicle_vx: 3, vehicle_vy: 0, vehicle_vz: -4,
    character: "gorece",
  });
  const snapshot = await second.next((message) => message.type === "snapshot"
    && message.players.some((player) => player.seq === 1 && player.riding && player.vehicle_id === "hilux_01"));
  const relayDelayMs = performance.now() - stateSentAt;
  assert.ok(relayDelayMs < 50, `state relay waited too long (${relayDelayMs.toFixed(1)} ms)`);
  const sharedVehicleState = snapshot.players.find((player) => player.vehicle_id === "hilux_01");
  assert.equal(sharedVehicleState.vehicle, "hilux");
  assert.equal(sharedVehicleState.vehicle_x, 10);
  assert.equal(sharedVehicleState.vehicle_z, 12);
  assert.equal(sharedVehicleState.vx, 1.5);
  assert.equal(sharedVehicleState.vehicle_vz, -4);

  const staleSnapshot = second.next((message) => message.type === "snapshot"
    && message.players.some((player) => player.id === firstWelcome.id && player.x === 999), 120);
  first.send({ type: "state", seq: 1, x: 999, y: 0, z: 0, ry: 0, vx: 0, vy: 0, vz: 0, latency_ms: 0,
    vehicle_x: 999, vehicle_y: 0, vehicle_z: 0, vehicle_ry: 0, vehicle_vx: 0, vehicle_vy: 0, vehicle_vz: 0,
    vehicle: "hilux", vehicle_id: "hilux_01", riding: true, character: "gorece" });
  await assert.rejects(staleSnapshot, /Timed out waiting for server message/);

  first.send({ type: "vehicle_release", vehicle_id: "hilux_01" });
  await delay(120);
  second.send({ type: "vehicle_claim", vehicle_id: "hilux_01" });
  assert.equal((await second.next((message) => message.type === "vehicle_claim_result")).granted, true);

  second.send({ type: "vehicle_release", vehicle_id: "hilux_01" });
  dg.close();
  second.close();
  first.close();
  console.log(`multiplayer v4 integration test: immediate relay ${relayDelayMs.toFixed(1)} ms; DG identity, motorcycle access, Hilux restriction, stale state, jump and claims ok`);
} finally {
  for (const client of clients) client.close();
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
}
