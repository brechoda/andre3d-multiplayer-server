import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const spawnPath = join(root, "updates/files/config/spawn.json");
const spawnBytes = readFileSync(spawnPath);
const spawn = JSON.parse(spawnBytes.toString("utf8"));
const manifest = JSON.parse(readFileSync(join(root, "updates/manifest.json"), "utf8"));

assert.equal(spawn.map, "liberty_city");
assert.equal(spawn.map_region, "center");
assert.equal(spawn.spawn_revision, "global-10");
assert.deepEqual(Object.keys(spawn.regional_spawns), ["center"]);

const center = spawn.regional_spawns.center;
const expected = {
  player: [19.4, 4.7448, -19.6],
  gorece: [19.4, 4.7448, 30.4],
  pop100_01: [169.4, -4.5651, -19.6],
  wayfarer_01: [169.4, -4.0747, 30.4],
  hilux_01: [19.4, -0.0723, 280.4],
  fiatuno_01: [119.4, -14.0107, 180.4],
};

const actual = {
  player: center.player.position,
  gorece: center.gorece.position,
  ...Object.fromEntries(
    Object.entries(center.vehicles).map(([id, data]) => [id, data.position]),
  ),
};
assert.deepEqual(actual, expected, "Center world-space spawns must match the map's validated local spawn manifest");
assert.deepEqual(spawn.player, center.player);
assert.deepEqual(spawn.gorece, center.gorece);
assert.deepEqual(spawn.vehicles, center.vehicles);

const spawnEntry = manifest.files.find((entry) => entry.path === "config/spawn.json");
assert.ok(spawnEntry, "manifest must publish config/spawn.json");
assert.equal(spawnEntry.size, spawnBytes.length);
assert.equal(spawnEntry.sha256, createHash("sha256").update(spawnBytes).digest("hex"));

const centerPck = manifest.map_regions.find((entry) => entry.region === "center");
const centerPckFile = manifest.files.find((entry) => entry.region === "center");
assert.ok(centerPck, "manifest must publish the selected center PCK");
assert.deepEqual(centerPck, centerPckFile, "the downloadable and selectable center PCK entries must match");

console.log("Map spawn configuration, validated center coordinates, and manifest hashes are consistent.");
