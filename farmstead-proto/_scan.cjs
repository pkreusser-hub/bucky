#!/usr/bin/env node
"use strict";
/* Seed scout — pure node (fs-const/fs-map/fs-sim are sim-safe). Finds a small map
 * whose player-0 castle has trees + a mountain + water all close enough to frame
 * together in one hero shot, plus room for roads/huts. */
const path = require("path");
const DIR = process.argv[3] === "hd" ? "./hd" : ".";
const FSC = require(path.join(__dirname, DIR, "fs-const.js"));
const FSMap = require(path.join(__dirname, DIR, "fs-map.js"));
const FSSim = require(path.join(__dirname, DIR, "fs-sim.js"));

const SIZE = "small";
const out = [];
const N = parseInt(process.argv[2], 10) || 400;

for (let seed = 1; seed <= N; seed++) {
  let G;
  try { G = FSSim.newGame({ size: SIZE, seed, ais: 1 }); } catch (e) { continue; }
  const map = G.map;
  FSMap.bind(map);
  const v0 = map.starts[0];
  const xz0 = FSMap.worldXZ(map, v0, [0, 0]);
  // scan a radius-18 disc around the castle
  let trees = 0, mtn = 0, water = 0, grass = 0, stones = 0, flat = 0, total = 0;
  let mtnD = 99, watD = 99, treeD = 99, mtnH = 0;
  FSMap.forRadius(map, v0, 18, (u, d) => {
    total++;
    const t = map.terr[u], o = map.obj[u];
    if (t === FSC.TERR.GRASS) grass++;
    if (t === FSC.TERR.MOUNTAIN || t === FSC.TERR.SNOW) { mtn++; if (d < mtnD) mtnD = d; if (map.height[u] > mtnH) mtnH = map.height[u]; }
    if (t === FSC.TERR.WATER) { water++; if (d < watD) watD = d; }
    if (FSMap.isTree(o)) { trees++; if (d < treeD) treeD = d; }
    if (FSMap.isStone(o)) stones++;
    if (d <= 7 && t === FSC.TERR.GRASS && !FSMap.objBlocks(o)) flat++;
  });
  // buildable room: count vertices where a small building is legal within r=8
  let room = 0;
  FSMap.forRadius(map, v0, 8, (u) => { if (!FSMap.whyBuilding(map, "hut", u, 0)) room++; });

  // hero composition wants: forest close-ish, mountain visible but not on top of us,
  // water in frame, plenty of flat grass to build a village on.
  const okDist = mtnD >= 6 && mtnD <= 16 && watD >= 6 && watD <= 18 && treeD <= 8;
  if (!okDist) continue;
  const score =
    Math.min(trees, 90) * 1.0 +
    Math.min(mtn, 70) * 0.9 +
    Math.min(water, 70) * 0.9 +
    room * 1.4 +
    flat * 0.5 +
    Math.min(stones, 14) * 2 +
    mtnH * 3;
  out.push({ seed, score: Math.round(score), trees, mtn, water, stones, room, flat, mtnD, watD, treeD, mtnH: +mtnH.toFixed(1), x: +xz0[0].toFixed(1), z: +xz0[1].toFixed(1), W: map.W, H: map.H });
}
out.sort((a, b) => b.score - a.score);
console.log(JSON.stringify(out.slice(0, 14), null, 1));
console.log("candidates:", out.length, "of", N);
