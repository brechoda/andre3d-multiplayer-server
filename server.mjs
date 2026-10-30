import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8080);
const BUILD = process.env.BUILD || "andre3d-mp-v1";
const MAX_PLAYERS_PER_ROOM = 8;
const MAX_MESSAGE_BYTES = 4096;
const TICK_MS = 50;
const MELEE_COMBAT_RANGE = 2.05;
const ATTACK_RATE_LIMIT_MS = 180;
const HIT_RATE_LIMIT_MS = 250;
const HIT_AFTER_ATTACK_WINDOW_MS = 1400;
const ATTACK_ANIMATIONS = new Set(["FightA_1", "FightA_2", "FightA_3"]);
const rooms = new Map();
let nextId = 1;

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const safeText = (value, fallback, max = 24) => {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, max) || fallback;
};

function roomState(room) {
  return [...room.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    z: player.z,
    ry: player.ry,
    vehicle: player.vehicle,
    riding: player.riding,
    vehicle_x: player.vehicle_x,
    vehicle_y: player.vehicle_y,
    vehicle_z: player.vehicle_z,
    vehicle_ry: player.vehicle_ry,
    character: player.character,
  }));
}

function broadcast(room, payload, except = null) {
  const data = JSON.stringify(payload);
  for (const player of room.players.values()) {
    if (player.socket !== except && player.socket.readyState === 1) player.socket.send(data);
  }
}

function leave(player) {
  if (!player.room) return;
  const room = player.room;
  room.players.delete(player.id);
  player.room = null;
  broadcast(room, { type: "player_left", id: player.id });
  if (room.players.size === 0) rooms.delete(room.code);
}

const httpServer = http.createServer((request, response) => {
  if (request.url === "/health") {
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
    vehicle: "on_foot",
    riding: false,
    vehicle_x: 0,
    vehicle_y: 0,
    vehicle_z: 0,
    vehicle_ry: 0,
    character: "andre",
    lastStateAt: 0,
    lastAttackAt: 0,
    lastHitAt: 0,
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
      const code = safeText(message.room, "PUBLIC").toUpperCase();
      let room = rooms.get(code);
      if (!room) {
        room = { code, players: new Map() };
        rooms.set(code, room);
      }
      if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
        return socket.send(JSON.stringify({ type: "error", code: "ROOM_FULL" }));
      }
      player.name = safeText(message.name, player.id);
      player.character = message.character === "gorece" ? "gorece" : "andre";
      player.room = room;
      room.players.set(player.id, player);
      socket.send(JSON.stringify({ type: "welcome", id: player.id, room: room.code, players: roomState(room), maxPlayers: MAX_PLAYERS_PER_ROOM }));
      broadcast(room, { type: "player_joined", player: { id: player.id, name: player.name, x: 0, y: 0, z: 0, ry: 0, vehicle: "on_foot", riding: false, vehicle_x: 0, vehicle_y: 0, vehicle_z: 0, vehicle_ry: 0, character: player.character } }, socket);
      return;
    }

    if (!player.room) return;
    if (message.type === "state") {
      const now = Date.now();
      if (now - player.lastStateAt < 25) return;
      player.lastStateAt = now;
      const values = [message.x, message.y, message.z, message.ry];
      if (!values.every(isFiniteNumber)) return;
      player.x = clamp(message.x, -10000, 10000);
      player.y = clamp(message.y, -100, 1000);
      player.z = clamp(message.z, -10000, 10000);
      player.ry = clamp(message.ry, -Math.PI * 4, Math.PI * 4);
      player.vehicle = safeText(message.vehicle, "on_foot", 20);
      player.riding = message.riding === true;
      player.vehicle_x = clamp(isFiniteNumber(message.vehicle_x) ? message.vehicle_x : player.x, -10000, 10000);
      player.vehicle_y = clamp(isFiniteNumber(message.vehicle_y) ? message.vehicle_y : player.y, -100, 1000);
      player.vehicle_z = clamp(isFiniteNumber(message.vehicle_z) ? message.vehicle_z : player.z, -10000, 10000);
      player.vehicle_ry = clamp(isFiniteNumber(message.vehicle_ry) ? message.vehicle_ry : player.ry, -Math.PI * 4, Math.PI * 4);
      if (message.character === "andre" || message.character === "gorece") {
        player.character = message.character;
      }
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

setInterval(() => {
  for (const room of rooms.values()) broadcast(room, { type: "snapshot", players: roomState(room) });
}, TICK_MS);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[andre3d-server] listening on 0.0.0.0:${PORT} build=${BUILD}`);
});
