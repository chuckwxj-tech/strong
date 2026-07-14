import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./cloudflare-workers-loader.mjs", import.meta.url);

const routeUrl = new URL("../app/api/workouts/route.ts", import.meta.url);
const pageUrl = new URL("../app/page.tsx", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the REST / SET workout timer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>REST \/ SET · 组间计时与训练记录<\/title>/i);
  assert.match(html, /REST/);
  assert.match(html, /SET/);
  assert.match(html, /力量训练组间控制/);
  assert.match(html, /记录动作数据/);
  assert.match(html, /完成本组 · 开始休息/);
  assert.match(html, /训练记录/);
});

test("workout API validates runtime input and uses the Drizzle schema", async () => {
  const route = await readFile(routeUrl, "utf8");

  assert.match(route, /from "drizzle-orm"/);
  assert.match(route, /import \{ getDb \} from "\.\.\/\.\.\/\.\.\/db"/);
  assert.match(route, /import \{ exercisePresets, workoutSets \} from "\.\.\/\.\.\/\.\.\/db\/schema"/);
  assert.match(route, /typeof record\?\.exercise === "string"/);
  assert.match(route, /Number\.isSafeInteger\(record\.completedAt\)/);
  assert.match(route, /record\.heartRateBpm === null/);
  assert.match(route, /Number\.isInteger\(record\.heartRateBpm\)/);
  assert.match(route, /\.from\(workoutSets\)/);
  assert.match(route, /\.insert\(workoutSets\)/);
  assert.match(route, /\.delete\(workoutSets\)/);
  assert.match(route, /existingRecord\.deviceId !== deviceId/);
  assert.match(route, /setWhere: eq\(workoutSets\.deviceId, deviceId\)/);

  assert.doesNotMatch(route, /CREATE (?:TABLE|INDEX)/i);
  assert.doesNotMatch(route, /initializeSchema|type Statement|type Database/);
});

test("finish cue releases audio and failed saves roll back", async () => {
  const page = await readFile(pageUrl, "utf8");
  const cue = page.slice(
    page.indexOf("function playFinishCue"),
    page.indexOf("export default function Home"),
  );
  const recordSet = page.slice(
    page.indexOf("const recordSet"),
    page.indexOf("const handlePrimary"),
  );
  const failure = recordSet.slice(recordSet.indexOf("} catch {"));

  assert.match(cue, /addEventListener\("ended"/);
  assert.match(cue, /audio\.close\(\)/);
  assert.match(cue, /window\.setTimeout\(closeAudio, 1000\)/);
  assert.match(
    failure,
    /setRecords\(\(current\) => current\.filter\(\(entry\) => entry\.id !== item\.id\)\)/,
  );
  assert.doesNotMatch(failure, /setExercise|setWeightKg|setReps/);
});
