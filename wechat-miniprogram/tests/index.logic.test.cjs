const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = path.resolve(__dirname, "..");
const pagePath = path.join(projectRoot, "miniprogram", "pages", "index", "index");
const source = fs.readFileSync(`${pagePath}.js`, "utf8");
const wxml = fs.readFileSync(`${pagePath}.wxml`, "utf8");
const wxss = fs.readFileSync(`${pagePath}.wxss`, "utf8");

function clone(value) {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function todayKey() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const storage = new Map();
const modalResults = [];
const toasts = [];
let failingStorageKey = "";
const dateKey = todayKey();
storage.set("recent_exercises", ["杠铃卧推", "器械推胸"]);
storage.set(`workout_${dateKey}`, [{
  id: 1,
  exerciseName: "杠铃卧推",
  weight: 70,
  reps: 6,
  restSeconds: 75,
  time: "09:00",
  dateKey,
}]);

const wx = {
  getStorageSync(key) {
    return storage.has(key) ? clone(storage.get(key)) : "";
  },
  setStorageSync(key, value) {
    if (key === failingStorageKey) throw new Error("mock quota exceeded");
    storage.set(key, clone(value));
  },
  getStorageInfoSync() {
    return { keys: [...storage.keys()] };
  },
  setStorage({ key, data, success }) {
    storage.set(key, clone(data));
    if (success) success();
  },
  showModal(options) {
    const result = modalResults.shift() || { confirm: true, cancel: false };
    if (options.success) options.success(result);
  },
  showToast(options) {
    toasts.push(options.title);
  },
  onBLECharacteristicValueChange(handler) {
    this.bleHandler = handler;
  },
  offBLECharacteristicValueChange() {},
  setKeepScreenOn() {},
  stopBluetoothDevicesDiscovery() {},
  offBluetoothDeviceFound() {},
  closeBLEConnection() {},
  vibrateShort() {},
  vibrateLong() {},
  createSelectorQuery() {
    let callback;
    const query = {
      in() { return query; },
      select() { return query; },
      boundingClientRect(next) { callback = next; return query; },
      exec() { if (callback) callback(null); return query; },
    };
    return query;
  },
};

let definition;
vm.runInNewContext(source, {
  Page(value) { definition = value; },
  wx,
  console,
  setTimeout(callback) { callback(); return 1; },
  clearTimeout() {},
  setInterval() { return 1; },
  clearInterval() {},
}, { filename: `${pagePath}.js` });

assert(definition, "Page definition should load");
const page = { ...definition, data: clone(definition.data) };
page.setData = function setData(update, callback) {
  Object.assign(this.data, clone(update));
  if (callback) callback.call(this);
};

page.onLoad();
assert(page.data.exerciseLibrary.length >= 14, "legacy actions should migrate into the full library");
assert(page.data.quickExercises.length > 2, "training page should show more than two quick actions");
assert(page.data.exerciseLibrary.some((item) => item.name === "器械推胸"), "custom legacy action should remain");

const bench = page.data.exerciseLibrary.find((item) => item.id === "barbell_bench_press");
assert(bench, "default bench press should exist");
const farmerWalk = page.data.exerciseLibrary.find((item) => item.id === "farmer_walk");
assert(farmerWalk, "farmer walk should be added to migrated libraries");
assert.strictEqual(farmerWalk.measureType, "duration", "farmer walk should default to duration tracking");
assert.strictEqual(
  page.data.exerciseLibrary.find((item) => item.id === "plank").measureType,
  "duration",
  "plank should default to duration tracking",
);
assert.strictEqual(
  page.getSetMeasureType({ exerciseId: farmerWalk.id, exerciseName: farmerWalk.name, reps: 40 }),
  "reps",
  "legacy records without an explicit type must remain rep-based",
);

page.onFieldInput({
  currentTarget: { dataset: { key: "exerciseName" } },
  detail: { value: farmerWalk.name },
});
page.onFieldBlur({ currentTarget: { dataset: { key: "exerciseName" } } });
assert.strictEqual(page.data.exerciseId, farmerWalk.id, "typing an exact action name should select it");
assert.strictEqual(page.data.measureType, "duration", "typing farmer walk should switch to duration mode");
assert.strictEqual(page.data.reps, "30", "typed duration actions should use the 30-second default");

page.selectExercise({ currentTarget: { dataset: { id: farmerWalk.id } } });
assert.strictEqual(page.data.measureType, "duration", "selecting farmer walk should switch the input to duration");
assert.strictEqual(page.data.reps, "30", "a new duration action should keep a compatible duration value");
Object.assign(page.data, { weight: "24", restSeconds: "90" });
page.toggleFarmerSide({ currentTarget: { dataset: { side: "left" } } });
assert.strictEqual(page.data.farmerActiveSide, "left", "left-side timing should start on demand");
page.toggleFarmerSide({ currentTarget: { dataset: { side: "left" } } });
assert.strictEqual(page.data.farmerActiveSide, "left", "an immediate double tap must not finish the timer");
page.toggleFarmerSide({ currentTarget: { dataset: { side: "right" } } });
assert.strictEqual(page.data.farmerActiveSide, "left", "the opposite side cannot start while one side is running");
const leftStartedAt = Date.now() - 40250;
page.farmerStartedAt = leftStartedAt;
page.farmerSideStartedAt.left = leftStartedAt;
page.onHide();
page.onShow();
page.toggleFarmerSide({ currentTarget: { dataset: { side: "left" } } });
assert.strictEqual(page.data.farmerActiveSide, "", "left-side timing should stop on demand");
assert(page.data.farmerLeftDurationMs >= 40000, "elapsed time should come from timestamps after backgrounding");
page.adjustMetricValue("weight", 2.5);
assert.strictEqual(page.data.weight, "24", "the shared per-hand weight should lock after timing starts");
const setCountAfterLeft = storage.get(`workout_${dateKey}`).length;
page.completeSet();
assert.strictEqual(page.data.mode, "training", "one completed side must not save a farmer-walk set");
assert.strictEqual(storage.get(`workout_${dateKey}`).length, setCountAfterLeft, "one side must not add a workout set");
page.selectExercise({ currentTarget: { dataset: { id: bench.id } } });
assert.strictEqual(page.data.exerciseId, farmerWalk.id, "unfinished farmer timing should block action switching");

page.toggleFarmerSide({ currentTarget: { dataset: { side: "right" } } });
const rightStartedAt = Date.now() - 37400;
page.farmerStartedAt = rightStartedAt;
page.farmerSideStartedAt.right = rightStartedAt;
page.toggleFarmerSide({ currentTarget: { dataset: { side: "right" } } });
assert(page.data.farmerRightDurationMs >= 37000, "right-side elapsed time should be recorded independently");
failingStorageKey = `workout_${dateKey}`;
page.completeSet();
assert.strictEqual(page.data.mode, "training", "a failed farmer-walk write should stay on the training screen");
assert(page.data.farmerLeftDurationMs > 0 && page.data.farmerRightDurationMs > 0, "failed writes must preserve both timings");
failingStorageKey = "";
page.completeSet();
const farmerSet = storage.get(`workout_${dateKey}`)[0];
assert.strictEqual(farmerSet.measureType, "duration", "timed sets should store their measure type");
assert.strictEqual(farmerSet.trackingMode, "farmer_sides", "farmer walk should store side-based tracking");
assert(farmerSet.leftDurationSeconds >= 40, "farmer walk should store left-side seconds");
assert(farmerSet.rightDurationSeconds >= 37, "farmer walk should store right-side seconds");
assert.strictEqual(
  farmerSet.durationSeconds,
  Math.round((farmerSet.leftDurationSeconds + farmerSet.rightDurationSeconds) * 10) / 10,
  "the compatibility duration should equal total active time",
);
assert.strictEqual(page.data.totalVolume, 420, "timed sets must not be mixed into kg training volume");
assert.strictEqual(page.data.mode, "rest", "a completed left-right pair should enter rest once");
assert.strictEqual(page.findLastPerformance(farmerWalk.id, farmerWalk.name).trackingMode, "farmer_sides", "last performance should retain side timings");
page.startNextSet();
page.selectExercise({ currentTarget: { dataset: { id: farmerWalk.id } } });
assert.strictEqual(page.data.farmerLeftDurationMs, 0, "the next set should start with an empty left timer");
assert.strictEqual(page.data.farmerRightDurationMs, 0, "the next set should start with an empty right timer");

page.selectExercise({ currentTarget: { dataset: { id: bench.id } } });
assert.strictEqual(page.data.weight, "70", "selecting an action should restore its last weight");
assert.strictEqual(page.data.reps, "6", "selecting an action should restore its last reps");
assert.strictEqual(page.data.restSeconds, "75", "selecting an action should restore its last rest time");

Object.assign(page.data, {
  mode: "training",
  exerciseId: bench.id,
  exerciseName: bench.name,
  weight: "72.5",
  reps: "7",
  restSeconds: "80",
  heartRate: 138,
});
page.completeSet();
const completedSets = storage.get(`workout_${dateKey}`);
assert.strictEqual(page.data.mode, "rest", "completing a set should open the rest screen");
assert.strictEqual(completedSets[0].exerciseId, bench.id, "completed set should store a stable exercise id");
assert.strictEqual(completedSets[0].restSeconds, 80, "completed set should store its planned rest time");
assert.strictEqual(page.findLastPerformance(bench.id, bench.name).weight, 72.5, "last performance should update incrementally");

page.startNextSet();
assert.strictEqual(page.data.mode, "training", "next set should return to training mode");
page.openExerciseManager();
page.onExerciseOptionInput({
  currentTarget: { dataset: { id: bench.id } },
  detail: { value: "平板卧推" },
});
page.saveExerciseOptions();
const renamedBench = page.data.exerciseLibrary.find((item) => item.id === bench.id);
assert.strictEqual(renamedBench.name, "平板卧推", "library action should be editable");
assert(
  storage.get(`workout_${dateKey}`)
    .filter((set) => set.exerciseName === "杠铃卧推")
    .every((set) => set.exerciseId === bench.id),
  "old workout sets should receive stable ids before a rename",
);
assert(page.findLastPerformance(bench.id, renamedBench.name), "renaming an action should preserve its history lookup");

const incline = page.data.exerciseLibrary.find((item) => item.id === "incline_press");
page.openExerciseManager();
page.toggleExerciseFavorite({ currentTarget: { dataset: { id: incline.id } } });
page.toggleExerciseArchive({ currentTarget: { dataset: { id: incline.id } } });
page.saveExerciseOptions();
assert(page.data.exerciseLibrary.find((item) => item.id === incline.id).archived, "actions should be archivable without deleting history");

modalResults.push({ confirm: true, cancel: false, content: "胸部训练 A" });
page.saveTodayAsTemplate();
assert.strictEqual(page.data.templates.length, 1, "today's actions should save as a template");
assert.strictEqual(page.data.templates[0].exercises[0].exerciseName, "平板卧推", "templates should use the current library name");
const farmerTemplateExercise = page.data.templates[0].exercises.find((item) => item.exerciseId === farmerWalk.id);
assert.strictEqual(farmerTemplateExercise.measureType, "duration", "templates should preserve duration mode");
assert.strictEqual(farmerTemplateExercise.durationSeconds, farmerSet.durationSeconds, "templates should preserve the compatible total duration");
page.startTemplate({ currentTarget: { dataset: { id: page.data.templates[0].id } } });
assert.strictEqual(page.data.activeTemplateIndex, 0, "starting a template should select its first action");
assert.strictEqual(page.data.exerciseName, "平板卧推", "template should load the selected action");
const farmerTemplateIndex = page.data.activeTemplateExercises.findIndex((item) => item.exerciseId === farmerWalk.id);
page.selectTemplateExercise({ currentTarget: { dataset: { index: farmerTemplateIndex } } });
assert.strictEqual(page.data.measureType, "duration", "loading a timed template action should restore duration mode");
assert.strictEqual(page.data.reps, String(farmerSet.durationSeconds), "loading a timed template action should retain compatibility data");
assert.strictEqual(page.data.farmerLeftDurationMs, 0, "templates must not preload completed left-side timing");
assert.strictEqual(page.data.farmerRightDurationMs, 0, "templates must not preload completed right-side timing");
page.selectExercise({ currentTarget: { dataset: { id: bench.id } } });

page.openExerciseManager();
page.onExerciseMeasureTypeChange({ currentTarget: { dataset: { id: farmerWalk.id } }, detail: { value: 0 } });
page.saveExerciseOptions();
let updatedFarmerTemplate = page.data.templates[0].exercises.find((item) => item.exerciseId === farmerWalk.id);
assert.strictEqual(updatedFarmerTemplate.measureType, "duration", "farmer walk must remain a timed action");
assert.strictEqual(updatedFarmerTemplate.durationSeconds, farmerSet.durationSeconds, "locking farmer walk must not alter its template duration");

page.openExerciseManager();
page.onExerciseMeasureTypeChange({ currentTarget: { dataset: { id: bench.id } }, detail: { value: 1 } });
page.saveExerciseOptions();
let updatedBenchTemplate = page.data.templates[0].exercises.find((item) => item.exerciseId === bench.id);
assert.strictEqual(updatedBenchTemplate.measureType, "duration", "ordinary actions can still change to duration mode");
assert.strictEqual(updatedBenchTemplate.durationSeconds, 30, "changing reps to seconds should use the duration default");
page.openExerciseManager();
page.onExerciseMeasureTypeChange({ currentTarget: { dataset: { id: bench.id } }, detail: { value: 0 } });
page.saveExerciseOptions();
updatedBenchTemplate = page.data.templates[0].exercises.find((item) => item.exerciseId === bench.id);
assert.strictEqual(updatedBenchTemplate.measureType, "reps", "ordinary actions can change back to rep mode");
assert.strictEqual(updatedBenchTemplate.reps, 8, "changing seconds to reps should use the rep default");
assert.strictEqual(updatedBenchTemplate.durationSeconds, null, "rep templates should clear stale durationSeconds");

page.recordHeartRate(132);
assert.strictEqual(page.data.heartRate, 132, "heart-rate display should still update");
assert.strictEqual(page.data.heartSampleCount, 1, "heart-rate samples should still be counted");

failingStorageKey = "exercise_last_performance_v1";
Object.assign(page.data, {
  mode: "training",
  exerciseId: bench.id,
  exerciseName: "平板卧推",
  weight: "77.5",
  reps: "5",
  restSeconds: "90",
});
page.isCompletingSet = false;
page.completeSet();
assert.strictEqual(page.data.mode, "rest", "an auxiliary performance-cache quota error must not block the rest screen");
failingStorageKey = `workout_${dateKey}`;
page.startNextSet();
assert.strictEqual(page.data.mode, "training", "a recovery-summary quota error must not trap the user on the rest screen");
failingStorageKey = "";

const setsBeforePrimaryFailure = storage.get(`workout_${dateKey}`).length;
failingStorageKey = `workout_${dateKey}`;
Object.assign(page.data, { mode: "training", weight: "82.5", reps: "4" });
page.isCompletingSet = false;
page.completeSet();
assert.strictEqual(page.data.mode, "training", "a primary workout write failure should stay on the training screen");
assert.strictEqual(page.isCompletingSet, false, "a primary workout write failure should release the double-tap guard");
assert.strictEqual(storage.get(`workout_${dateKey}`).length, setsBeforePrimaryFailure, "a failed write should not alter stored sets");
failingStorageKey = "";

const previousDateKey = "1999-12-31";
const previousDaySets = [{
  id: 14,
  exerciseId: bench.id,
  exerciseName: "平板卧推",
  weight: 60,
  reps: 8,
  restSeconds: 90,
  time: "23:59",
  dateKey: previousDateKey,
}];
storage.set(`workout_${previousDateKey}`, clone(previousDaySets));
storage.delete(`workout_${dateKey}`);
Object.assign(page.data, { mode: "training", sets: clone(previousDaySets), weight: "85", reps: "3" });
page.workoutDateKey = previousDateKey;
page.isCompletingSet = false;
failingStorageKey = `workout_${dateKey}`;
page.completeSet();
assert.strictEqual(page.workoutDateKey, previousDateKey, "a failed first write after midnight should keep the previous date key");
failingStorageKey = "";
page.completeSet();
assert.strictEqual(storage.get(`workout_${dateKey}`).length, 1, "retrying after midnight must not copy yesterday's sets into today");
page.startNextSet();

const syntheticSets = [
  { id: 103, exerciseId: bench.id, exerciseName: "平板卧推", weight: 80, reps: 5, restSeconds: 90, time: "11:03", dateKey },
  { id: 102, exerciseId: bench.id, exerciseName: "平板卧推", weight: 75, reps: 6, restSeconds: 90, time: "11:02", dateKey },
  { id: 101, exerciseId: bench.id, exerciseName: "平板卧推", weight: 70, reps: 8, restSeconds: 90, time: "11:01", dateKey },
];
storage.set(`workout_${dateKey}`, clone(syntheticSets));
Object.assign(page.data, { sets: clone(syntheticSets), exerciseId: bench.id, exerciseName: "平板卧推" });
page.lastPerformanceMap = page.rebuildLastPerformanceIndex(page.data.exerciseLibrary);

modalResults.push({ confirm: true, cancel: false });
page.removeSet({ currentTarget: { dataset: { id: 102 } } });
assert.strictEqual(page.data.lastPerformance.weight, 80, "deleting a non-latest set should keep the latest performance");
modalResults.push({ confirm: true, cancel: false });
page.removeSet({ currentTarget: { dataset: { id: 103 } } });
assert.strictEqual(page.data.lastPerformance.weight, 70, "deleting the latest set should reveal the previous performance");
modalResults.push({ confirm: true, cancel: false });
page.removeSet({ currentTarget: { dataset: { id: 101 } } });
assert.strictEqual(page.data.lastPerformance.weight, 60, "deleting today's last set should fall back to the previous day's performance");

const timedSyntheticSets = [
  { id: 202, exerciseId: farmerWalk.id, exerciseName: farmerWalk.name, measureType: "duration", durationSeconds: 60, reps: 60, weight: 24, restSeconds: 90, time: "12:02", dateKey },
  { id: 201, exerciseId: farmerWalk.id, exerciseName: farmerWalk.name, measureType: "duration", durationSeconds: 40, reps: 40, weight: 20, restSeconds: 90, time: "12:01", dateKey },
];
storage.set(`workout_${dateKey}`, clone(timedSyntheticSets));
Object.assign(page.data, {
  sets: clone(timedSyntheticSets),
  exerciseId: farmerWalk.id,
  exerciseName: farmerWalk.name,
  measureType: "duration",
});
page.lastPerformanceMap = page.rebuildLastPerformanceIndex(page.data.exerciseLibrary);
modalResults.push({ confirm: true, cancel: false });
page.removeSet({ currentTarget: { dataset: { id: 202 } } });
assert.strictEqual(page.data.lastPerformance.measureType, "duration", "deleting a timed set should retain duration semantics");
assert.strictEqual(page.data.lastPerformance.reps, 40, "deleting the latest timed set should reveal the previous duration");

const farmerSideSyntheticSets = [
  {
    id: 302,
    exerciseId: farmerWalk.id,
    exerciseName: farmerWalk.name,
    measureType: "duration",
    trackingMode: "farmer_sides",
    durationSeconds: 83,
    reps: 83,
    leftDurationSeconds: 42,
    rightDurationSeconds: 41,
    leftStartedAt: 302000,
    leftEndedAt: 344000,
    rightStartedAt: 350000,
    rightEndedAt: 391000,
    weight: 26,
    restSeconds: 90,
    time: "12:04",
    dateKey,
  },
  {
    id: 301,
    exerciseId: farmerWalk.id,
    exerciseName: farmerWalk.name,
    measureType: "duration",
    trackingMode: "farmer_sides",
    durationSeconds: 77,
    reps: 77,
    leftDurationSeconds: 40,
    rightDurationSeconds: 37,
    leftStartedAt: 201000,
    leftEndedAt: 241000,
    rightStartedAt: 245000,
    rightEndedAt: 282000,
    weight: 24,
    restSeconds: 90,
    time: "12:03",
    dateKey,
  },
];
storage.set(`workout_${dateKey}`, clone(farmerSideSyntheticSets));
Object.assign(page.data, { sets: clone(farmerSideSyntheticSets) });
page.lastPerformanceMap = page.rebuildLastPerformanceIndex(page.data.exerciseLibrary);
modalResults.push({ confirm: true, cancel: false });
page.removeSet({ currentTarget: { dataset: { id: 302 } } });
assert.strictEqual(page.data.lastPerformance.trackingMode, "farmer_sides", "deletion fallback should retain farmer side tracking");
assert.strictEqual(page.data.lastPerformance.leftDurationSeconds, 40, "deletion fallback should restore left-side duration");
assert.strictEqual(page.data.lastPerformance.rightDurationSeconds, 37, "deletion fallback should restore right-side duration");

const sanitizedWxml = wxml.replace(/\{\{[\s\S]*?\}\}/g, "expression");
const stack = [];
const voidTags = new Set(["input", "image"]);
for (const match of sanitizedWxml.matchAll(/<\/?([\w-]+)(?:\s[^<>]*?)?\s*\/?>/g)) {
  const tag = match[1];
  if (match[0].startsWith("</")) {
    assert.strictEqual(tag, stack.pop(), `unexpected closing tag ${tag}`);
  } else if (!match[0].endsWith("/>") && !voidTags.has(tag)) {
    stack.push(tag);
  }
}
assert.deepStrictEqual(stack, [], "WXML tags should be balanced");

const handlers = [...wxml.matchAll(/(?:bind|catch)[\w:]*="([\w]+)"/g)].map((match) => match[1]);
handlers.filter((handler) => handler !== "true").forEach((handler) => {
  assert.strictEqual(typeof definition[handler], "function", `missing WXML handler: ${handler}`);
});

let braceDepth = 0;
for (const character of wxss.replace(/\/\*[\s\S]*?\*\//g, "")) {
  if (character === "{") braceDepth += 1;
  if (character === "}") braceDepth -= 1;
  assert(braceDepth >= 0, "WXSS should not contain an extra closing brace");
}
assert.strictEqual(braceDepth, 0, "WXSS braces should be balanced");

console.log("index logic and static checks passed");
