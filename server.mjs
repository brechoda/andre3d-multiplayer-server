import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8080);
const BUILD = process.env.BUILD || "andre3d-mp-v4";
const MIN_CLIENT_VERSION = process.env.MIN_CLIENT_VERSION || "2.1.1";
const MAX_PLAYERS_PER_ROOM = 8;
const MAX_MESSAGE_BYTES = 4096;
const MAX_BUFFERED_STATE_BYTES = 64 * 1024;
const MELEE_COMBAT_RANGE = 2.05;
const ATTACK_RATE_LIMIT_MS = 180;
const HIT_RATE_LIMIT_MS = 250;
const HIT_AFTER_ATTACK_WINDOW_MS = 1400;
const JUMP_RATE_LIMIT_MS = 250;
const VOICE_RATE_LIMIT_MS = 35;
const MAX_VOICE_BASE64_LENGTH = 1200;
const UPDATES_ROOT = path.resolve(process.cwd(), "updates");
const VEHICLE_TYPES = new Map([
  ["pop100_01", "pop100"],
  ["wayfarer_01", "wayfarer"],
  ["hilux_01", "hilux"],
  ["fiatuno_01", "fiatuno"],
]);
const CHARACTERS = new Set(["andre", "gorece", "dg"]);
const ATTACK_ANIMATIONS = new Set(["FightA_1", "FightA_2", "FightA_3"]);
const rooms = new Map();
let nextId = 1;

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const safeText = (value, fallback, max = 24) => {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, max) || fallback;
};

const compareVersions = (left, right) => {
  const a = String(left || "0.0.0").split(".").map((value) => Number.parseInt(value, 10) || 0);
  const b = String(right || "0.0.0").split(".").map((value) => Number.parseInt(value, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
};

function playerState(player) {
  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    z: player.z,
    ry: player.ry,
    seq: player.stateSequence,
    vx: player.vx,
    vy: player.vy,
    vz: player.vz,
    running: player.running,
    latency_ms: player.latencyMs,
    vehicle: player.vehicle,
    vehicle_id: player.vehicle_id,
    riding: player.riding,
    vehicle_x: player.vehicle_x,
    vehicle_y: player.vehicle_y,
    vehicle_z: player.vehicle_z,
    vehicle_ry: player.vehicle_ry,
    vehicle_vx: player.vehicle_vx,
    vehicle_vy: player.vehicle_vy,
    vehicle_vz: player.vehicle_vz,
    vehicle_audio: player.vehicle_audio,
    vehicle_wheelie: player.vehicle_wheelie,
    character: player.character,
  };
}

function roomState(room) {
  return [...room.players.values()].map(playerState);
}

function broadcast(room, payload, except = null) {
  const data = JSON.stringify(payload);
  for (const player of room.players.values()) {
    if (player.socket !== except && player.socket.readyState === 1) player.socket.send(data);
  }
}

function broadcastState(room, player, except = null) {
  const data = JSON.stringify({ type: "snapshot", players: [playerState(player)] });
  for (const recipient of room.players.values()) {
    if (recipient.socket === except || recipient.socket.readyState !== 1) continue;
    // A slow client should receive a fresh pose, not a growing queue of obsolete poses.
    if (recipient.socket.bufferedAmount <= MAX_BUFFERED_STATE_BYTES) recipient.socket.send(data);
  }
}

function leave(player) {
  if (!player.room) return;
  const room = player.room;
  if (player.claimedVehicleId && room.vehicleOwners.get(player.claimedVehicleId) === player.id) {
    room.vehicleOwners.delete(player.claimedVehicleId);
  }
  room.players.delete(player.id);
  player.room = null;
  broadcast(room, { type: "player_left", id: player.id });
  if (room.players.size === 0) rooms.delete(room.code);
}

const contentTypes = new Map([
  [".json", "application/json; charset=utf-8"],
  [".pck", "application/octet-stream"],
  [".zip", "application/zip"],
]);

const serveUpdateFile = async (request, response, pathname) => {
  const relativePath = pathname.slice("/updates/".length);
  if (!relativePath || relativePath.includes("..") || relativePath.includes("\\")) {
    response.writeHead(400);
    response.end("invalid update path");
    return;
  }
  const filePath = path.resolve(UPDATES_ROOT, relativePath);
  if (filePath !== UPDATES_ROOT && !filePath.startsWith(`${UPDATES_ROOT}${path.sep}`)) {
    response.writeHead(400);
    response.end("invalid update path");
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const type = contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
    response.writeHead(200, {
      "content-type": type,
      "cache-control": relativePath === "manifest.json" ? "no-cache" : "public, max-age=31536000, immutable",
      "content-length": data.byteLength,
    });
    if (request.method !== "HEAD") response.end(data);
    else response.end();
  } catch {
    response.writeHead(404);
    response.end("update file not found");
  }
};

const httpServer = http.createServer(async (request, response) => {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (request.method === "GET" || request.method === "HEAD") {
    if (pathname.startsWith("/updates/")) {
      await serveUpdateFile(request, response, pathname);
      return;
    }
  }
  if (pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, build: BUILD, rooms: rooms.size }));
    return;
  }
  response.writeHead(404);
  response.end("not found");
});

const websocketServer = new WebSocketServer({ server: httpServer, path: "/ws", maxPayload: MAX_MESSAGE_BYTES });

websocketServer.on("connection", (socket) => {
  const player = {
    id: `p${nextId++}`,
    socket,
    room: null,
    name: "Jogador",
    x: 0,
    y: 0,
    z: 0,
    ry: 0,
    stateSequence: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    running: false,
    latencyMs: 0,
    vehicle: "on_foot",
    vehicle_id: "",
    claimedVehicleId: "",
    riding: false,
    vehicle_x: 0,
    vehicle_y: 0,
    vehicle_z: 0,
    vehicle_ry: 0,
    vehicle_vx: 0,
    vehicle_vy: 0,
    vehicle_vz: 0,
    vehicle_audio: "off",
    vehicle_wheelie: 0,
    character: "andre",
    lastStateAt: 0,
    lastJumpAt: 0,
    jumpSequence: 0,
    lastVehicleClaimAt: 0,
    lastAttackAt: 0,
    lastHitAt: 0,
    lastVoiceAt: 0,
  };

  socket.on("message", (raw) => {
    if (raw.length > MAX_MESSAGE_BYTES) return socket.close(1009, "message too large");
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message.type !== "string") return;

    if (message.type === "ping") {
      const sentAt = isFiniteNumber(message.sent_at) ? message.sent_at : 0;
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "pong", sent_at: sentAt }));
      return;
    }

    if (message.type === "join") {
      if (player.room) return;
      if (message.build !== BUILD) return socket.send(JSON.stringify({ type: "error", code: "BUILD_MISMATCH", build: BUILD }));
      if (compareVersions(message.app_version, MIN_CLIENT_VERSION) < 0) {
        return socket.send(JSON.stringify({ type: "error", code: "CLIENT_UPDATE_REQUIRED", min_version: MIN_CLIENT_VERSION }));
      }
      const code = safeText(message.room, "PUBLIC").toUpperCase();
      let room = rooms.get(code);
      if (!room) {
        room = { code, players: new Map(), vehicleOwners: new Map() };
        rooms.set(code, room);
      }
      if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
        return socket.send(JSON.stringify({ type: "error", code: "ROOM_FULL" }));
      }
      player.name = safeText(message.name, player.id);
      player.character = CHARACTERS.has(message.character) ? message.character : "andre";
      player.room = room;
      room.players.set(player.id, player);
      socket.send(JSON.stringify({ type: "welcome", id: player.id, room: room.code, players: roomState(room), maxPlayers: MAX_PLAYERS_PER_ROOM }));
      broadcast(room, { type: "player_joined", player: { id: player.id, name: player.name, x: 0, y: 0, z: 0, ry: 0, seq: 0, vx: 0, vy: 0, vz: 0, running: false, latency_ms: 0, vehicle: "on_foot", vehicle_id: "", riding: false, vehicle_x: 0, vehicle_y: 0, vehicle_z: 0, vehicle_ry: 0, vehicle_vx: 0, vehicle_vy: 0, vehicle_vz: 0, vehicle_audio: "off", vehicle_wheelie: 0, character: player.character } }, socket);
      return;
    }

    if (!player.room) return;
    if (message.type === "vehicle_claim") {
      const now = Date.now();
      const vehicleId = typeof message.vehicle_id === "string" ? message.vehicle_id : "";
      const ownerId = player.room.vehicleOwners.get(vehicleId);
      const vehicleType = VEHICLE_TYPES.get(vehicleId);
      let granted = true;
      let reason = "";
      if (now - player.lastVehicleClaimAt < 100) {
        granted = false;
        reason = "RATE_LIMITED";
      } else if (!vehicleType) {
        granted = false;
        reason = "UNKNOWN_VEHICLE";
      } else if (player.character === "dg" && vehicleId === "hilux_01") {
        granted = false;
        reason = "CHARACTER_CANNOT_USE_VEHICLE";
      } else if (player.claimedVehicleId && player.claimedVehicleId !== vehicleId) {
        granted = false;
        reason = "ALREADY_CLAIMED";
      } else if (ownerId && ownerId !== player.id) {
        granted = false;
        reason = "OCCUPIED";
      }
      player.lastVehicleClaimAt = now;
      if (granted) {
        player.room.vehicleOwners.set(vehicleId, player.id);
        player.claimedVehicleId = vehicleId;
      }
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "vehicle_claim_result", vehicle_id: vehicleId, granted, reason }));
      return;
    }
    if (message.type === "vehicle_release") {
      const vehicleId = typeof message.vehicle_id === "string" ? message.vehicle_id : "";
      if (player.claimedVehicleId === vehicleId && player.room.vehicleOwners.get(vehicleId) === player.id) {
        player.room.vehicleOwners.delete(vehicleId);
        player.claimedVehicleId = "";
        player.vehicle_id = "";
        player.vehicle = "on_foot";
        player.riding = false;
      }
      return;
    }
    if (message.type === "jump") {
      const now = Date.now();
      const sequence = message.seq;
      if (!Number.isSafeInteger(sequence) || sequence <= player.jumpSequence || player.riding) return;
      if (now - player.lastJumpAt < JUMP_RATE_LIMIT_MS) return;
      player.jumpSequence = sequence;
      player.lastJumpAt = now;
      broadcast(player.room, { type: "jump", id: player.id, seq: sequence }, socket);
      return;
    }
    if (message.type === "state") {
      const now = Date.now();
      const sequence = message.seq;
      if (!Number.isSafeInteger(sequence) || sequence <= player.stateSequence) return;
      if (now - player.lastStateAt < 20) return;
      const values = [message.x, message.y, message.z, message.ry, message.vx, message.vy, message.vz];
      if (!values.every(isFiniteNumber)) return;
      if (message.running !== undefined && typeof message.running !== "boolean") return;
      const vehicleValues = [message.vehicle_x, message.vehicle_y, message.vehicle_z, message.vehicle_ry, message.vehicle_vx, message.vehicle_vy, message.vehicle_vz];
      if (!vehicleValues.every(isFiniteNumber) || !isFiniteNumber(message.latency_ms)) return;
      if (message.vehicle_wheelie !== undefined && !isFiniteNumber(message.vehicle_wheelie)) return;
      const allowedAudio = new Set(["off", "idle", "accel", "decel"]);
      const requestedAudio = typeof message.vehicle_audio === "string" ? message.vehicle_audio : "off";
      if (!allowedAudio.has(requestedAudio)) return;
      player.x = clamp(message.x, -10000, 10000);
      player.y = clamp(message.y, -100, 1000);
      player.z = clamp(message.z, -10000, 10000);
      player.ry = clamp(message.ry, -Math.PI * 4, Math.PI * 4);
      player.vx = clamp(message.vx, -60, 60);
      player.vy = clamp(message.vy, -60, 60);
      player.vz = clamp(message.vz, -60, 60);
      player.running = message.running === true;
      player.latencyMs = clamp(message.latency_ms, 0, 250);
      const wantsToRide = message.riding === true;
      const requestedCharacter = CHARACTERS.has(message.character) ? message.character : player.character;
      if (wantsToRide) {
        const vehicleId = typeof message.vehicle_id === "string" ? message.vehicle_id : "";
        const vehicleType = VEHICLE_TYPES.get(vehicleId);
        if (requestedCharacter === "dg" && vehicleId === "hilux_01") {
          if (player.claimedVehicleId === vehicleId && player.room.vehicleOwners.get(vehicleId) === player.id) {
            player.room.vehicleOwners.delete(vehicleId);
            player.claimedVehicleId = "";
          }
          player.character = requestedCharacter;
          player.vehicle = "on_foot";
          player.vehicle_id = "";
          player.riding = false;
          player.vehicle_audio = "off";
          player.vehicle_wheelie = 0;
          player.stateSequence = sequence;
          player.lastStateAt = now;
          broadcastState(player.room, player, socket);
          if (socket.readyState === 1) socket.send(JSON.stringify({ type: "vehicle_claim_result", vehicle_id: vehicleId, granted: false, reason: "CHARACTER_CANNOT_USE_VEHICLE" }));
          return;
        }
        if (!vehicleType || player.claimedVehicleId !== vehicleId || player.room.vehicleOwners.get(vehicleId) !== player.id) {
          if (socket.readyState === 1) socket.send(JSON.stringify({ type: "vehicle_claim_result", vehicle_id: vehicleId, granted: false, reason: "CLAIM_REQUIRED" }));
          return;
        }
        player.vehicle = vehicleType;
        player.vehicle_id = vehicleId;
        player.riding = true;
      } else {
        player.vehicle = "on_foot";
        player.vehicle_id = "";
        player.riding = false;
      }
      player.vehicle_x = clamp(isFiniteNumber(message.vehicle_x) ? message.vehicle_x : player.x, -10000, 10000);
      player.vehicle_y = clamp(isFiniteNumber(message.vehicle_y) ? message.vehicle_y : player.y, -100, 1000);
      player.vehicle_z = clamp(isFiniteNumber(message.vehicle_z) ? message.vehicle_z : player.z, -10000, 10000);
      player.vehicle_ry = clamp(isFiniteNumber(message.vehicle_ry) ? message.vehicle_ry : player.ry, -Math.PI * 4, Math.PI * 4);
      player.vehicle_vx = clamp(message.vehicle_vx, -60, 60);
      player.vehicle_vy = clamp(message.vehicle_vy, -60, 60);
      player.vehicle_vz = clamp(message.vehicle_vz, -60, 60);
      player.vehicle_audio = player.riding ? requestedAudio : "off";
      player.vehicle_wheelie = player.riding && (player.vehicle === "pop100" || player.vehicle === "wayfarer")
        ? clamp(isFiniteNumber(message.vehicle_wheelie) ? message.vehicle_wheelie : 0, 0, 0.72)
        : 0;
      player.stateSequence = sequence;
      player.lastStateAt = now;
      player.character = requestedCharacter;
      broadcastState(player.room, player, socket);
      return;
    }
    if (message.type === "voice") {
      const now = Date.now();
      const payload = typeof message.data === "string" ? message.data : "";
      if (!payload || payload.length > MAX_VOICE_BASE64_LENGTH || now - player.lastVoiceAt < VOICE_RATE_LIMIT_MS) return;
      player.lastVoiceAt = now;
      broadcast(player.room, {
        type: "voice",
        id: player.id,
        x: player.x,
        y: player.y,
        z: player.z,
        data: payload,
      }, socket);
      return;
    }
    if (message.type === "combat") {
      const now = Date.now();
      const action = message.action;
      if (action !== "attack" && action !== "hit") return;
      if (action === "attack") {
        if (now - player.lastAttackAt < ATTACK_RATE_LIMIT_MS || !ATTACK_ANIMATIONS.has(message.animation)) return;
        player.lastAttackAt = now;
      }

      let targetId = "";
      if (action === "hit") {
        if (now - player.lastHitAt < HIT_RATE_LIMIT_MS || now - player.lastAttackAt > HIT_AFTER_ATTACK_WINDOW_MS) return;
        const target = player.room.players.get(String(message.target_id || ""));
        if (!target || target === player) return;
        const dx = target.x - player.x;
        const dz = target.z - player.z;
        if (Math.hypot(dx, dz) > MELEE_COMBAT_RANGE) return;
        targetId = target.id;
        player.lastHitAt = now;
      }

      broadcast(player.room, {
        type: "combat",
        attacker_id: player.id,
        action,
        animation: action === "attack" ? message.animation : "",
        target_id: targetId,
        x: player.x,
        y: player.y,
        z: player.z,
      });
      return;
    }
    if (message.type === "leave") socket.close(1000, "leave");
  });
  socket.on("close", () => leave(player));
  socket.on("error", () => leave(player));
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[andre3d-server] listening on 0.0.0.0:${PORT} build=${BUILD}`);
});
