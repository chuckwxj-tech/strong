const HEART_RATE_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb";
const HEART_RATE_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb";
const HEART_RATE_CHUNK_SIZE = 300;
const HEART_STORAGE_BATCH_SIZE = 10;
const HEART_DISPLAY_INTERVAL_MS = 1000;
const HEART_STORAGE_WARNING_RATIO = 0.8;
const HEART_RATE_RETENTION_DAYS = 30;
const RECOVERY_READY_BPM = 20;
const EXERCISE_LIBRARY_KEY = "exercise_library_v1";
const LAST_PERFORMANCE_KEY = "exercise_last_performance_v1";
const WORKOUT_TEMPLATES_KEY = "workout_templates_v1";
const MUSCLE_GROUPS = ["胸部", "背部", "肩部", "手臂", "臀腿", "核心", "其他"];
const MEASURE_TYPES = [
  { value: "reps", label: "次数" },
  { value: "duration", label: "计时" },
];
const DEFAULT_EXERCISES = [
  { id: "barbell_bench_press", name: "杠铃卧推", group: "胸部", favorite: true },
  { id: "incline_press", name: "上斜卧推", group: "胸部", favorite: false },
  { id: "chest_fly", name: "蝴蝶夹胸", group: "胸部", favorite: false },
  { id: "lat_pulldown", name: "高位下拉", group: "背部", favorite: true },
  { id: "seated_row", name: "坐姿划船", group: "背部", favorite: false },
  { id: "deadlift", name: "硬拉", group: "背部", favorite: true },
  { id: "overhead_press", name: "肩上推举", group: "肩部", favorite: false },
  { id: "lateral_raise", name: "侧平举", group: "肩部", favorite: false },
  { id: "biceps_curl", name: "弯举", group: "手臂", favorite: false },
  { id: "triceps_pushdown", name: "绳索下压", group: "手臂", favorite: false },
  { id: "barbell_squat", name: "深蹲", group: "臀腿", favorite: true },
  { id: "leg_press", name: "腿举", group: "臀腿", favorite: false },
  { id: "plank", name: "平板支撑", group: "核心", favorite: false, measureType: "duration" },
  { id: "farmer_walk", name: "农夫行走", group: "其他", favorite: false, measureType: "duration" },
];

function pad(value) {
  return String(value).padStart(2, "0");
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatClock(seconds) {
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

function formatStopwatch(milliseconds) {
  const totalTenths = Math.max(0, Math.floor((Number(milliseconds) || 0) / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  return `${pad(minutes)}:${pad(seconds)}.${totalTenths % 10}`;
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function normalizeMeasureType(value) {
  return value === "duration" ? "duration" : "reps";
}

function normalizeBleUuid(value) {
  const uuid = String(value || "").toLowerCase();
  return /^[0-9a-f]{4}$/.test(uuid)
    ? `0000${uuid}-0000-1000-8000-00805f9b34fb`
    : uuid;
}

function defaultMetricValue(measureType) {
  return measureType === "duration" ? 30 : 8;
}

Page({
  data: {
    mode: "training",
    dateLabel: "",
    exerciseId: "barbell_bench_press",
    exerciseName: "杠铃卧推",
    measureType: "reps",
    weight: "60",
    reps: "8",
    restSeconds: "90",
    timerRemaining: 90,
    timerText: "01:30",
    timerRunning: false,
    timerProgress: 100,
    farmerActiveSide: "",
    farmerLeftDurationMs: 0,
    farmerRightDurationMs: 0,
    farmerLeftText: "00:00.0",
    farmerRightText: "00:00.0",
    sets: [],
    totalVolume: 0,
    heartRate: "--",
    heartStatus: "连接心率设备",
    heartSampleCount: 0,
    heartAverage: "--",
    heartMaximum: "--",
    heartMinimum: "--",
    restPeak: "--",
    heartRecovery: "--",
    heartAt60: "--",
    recoveryStatus: "完成一组后开始分析恢复",
    recoveryReadyThreshold: RECOVERY_READY_BPM,
    bluetoothDevices: [],
    showDevices: false,
    scanning: false,
    connectedDeviceId: "",
    exerciseLibrary: [],
    quickExercises: [],
    muscleGroups: MUSCLE_GROUPS,
    measureTypes: MEASURE_TYPES,
    showExerciseManager: false,
    draftExercises: [],
    filteredDraftExercises: [],
    libraryMode: "favorites",
    libraryGroup: "全部",
    newExerciseName: "",
    newExerciseGroup: "其他",
    newExerciseGroupIndex: MUSCLE_GROUPS.length - 1,
    newExerciseMeasureType: "reps",
    newExerciseMeasureTypeIndex: 0,
    lastPerformance: null,
    showTemplateManager: false,
    templates: [],
    activeTemplateId: "",
    activeTemplateName: "",
    activeTemplateExercises: [],
    activeTemplateIndex: -1,
  },

  onLoad() {
    const date = new Date();
    const config = wx.getStorageSync("workout_config") || {};
    this.workoutDateKey = todayKey();
    const exerciseLibrary = this.loadExerciseLibrary();
    const sets = this.normalizeWorkoutSets(
      wx.getStorageSync(`workout_${this.workoutDateKey}`) || [],
    );
    this.lastPerformanceMap = wx.getStorageSync(LAST_PERFORMANCE_KEY) || {};
    if (!Object.keys(this.lastPerformanceMap).length || Object.values(this.lastPerformanceMap).some((item) => (
      !item || !["reps", "duration"].includes(item.measureType)
    ))) {
      this.lastPerformanceMap = this.rebuildLastPerformanceIndex(exerciseLibrary);
    }
    const templates = this.loadWorkoutTemplates();
    const configuredName = String(config.exerciseName || "杠铃卧推");
    const selectedExercise = exerciseLibrary.find((item) => item.id === config.exerciseId)
      || exerciseLibrary.find((item) => item.name === configuredName)
      || exerciseLibrary[0];
    const restSeconds = Math.max(15, Number(config.restSeconds) || 90);
    const heartStats = this.loadHeartStorage(todayKey());

    this.setData({
      dateLabel: `${date.getMonth() + 1}月${date.getDate()}日`,
      exerciseId: selectedExercise?.id || "",
      exerciseName: selectedExercise?.name || configuredName,
      measureType: normalizeMeasureType(selectedExercise?.measureType || config.measureType),
      weight: String(config.weight ?? 60),
      reps: String(config.reps ?? defaultMetricValue(selectedExercise?.measureType)),
      restSeconds: String(restSeconds),
      timerRemaining: restSeconds,
      timerText: formatClock(restSeconds),
      sets,
      totalVolume: this.calculateVolume(sets),
      exerciseLibrary,
      quickExercises: this.getQuickExercises(exerciseLibrary),
      templates,
      lastPerformance: this.findLastPerformance(selectedExercise?.id, selectedExercise?.name || configuredName),
      ...heartStats,
    });

    this.bleValueHandler = (result) => {
      if (!result || result.deviceId !== this.data.connectedDeviceId) return;
      if (!this.heartRateCharacteristicId
        || normalizeBleUuid(result.characteristicId) !== normalizeBleUuid(this.heartRateCharacteristicId)) return;
      const bytes = new Uint8Array(result.value);
      if (!bytes.length) return;
      const is16Bit = (bytes[0] & 0x01) === 1;
      const heartRate = is16Bit ? bytes[1] + (bytes[2] << 8) : bytes[1];
      if (heartRate) this.recordHeartRate(heartRate);
    };
    wx.onBLECharacteristicValueChange(this.bleValueHandler);

    this.bleConnectionStateHandler = (result) => {
      if (!result || result.connected || result.deviceId !== this.data.connectedDeviceId) return;
      this.saveHeartSamples();
      this.clearPendingHeartDisplay();
      this.heartRateCharacteristicId = "";
      this.setData({
        connectedDeviceId: "",
        heartRate: "--",
        heartStatus: "心率设备已断开，请重新连接",
      });
    };
    wx.onBLEConnectionStateChange(this.bleConnectionStateHandler);
    this.checkHeartStoragePressure();
  },

  onShow() {
    wx.setKeepScreenOn({ keepScreenOn: true, fail: () => {} });
    if (this.data.mode === "training") this.refreshWorkoutDay();
    if (this.data.farmerActiveSide && this.farmerStartedAt) {
      this.startFarmerTicker();
    }
    if (this.data.timerRunning && this.restEndAt) {
      this.startCountdownTicker();
    }
  },

  onHide() {
    this.clearTimer();
    this.clearFarmerTimer();
    this.stopStepper();
    this.saveHeartSamples();
  },

  onUnload() {
    this.clearTimer();
    this.clearFarmerTimer();
    this.stopStepper();
    this.flushHeartDisplay();
    this.saveHeartSamples();
    this.stopDeviceDiscovery();
    if (this.bleValueHandler && wx.offBLECharacteristicValueChange) {
      wx.offBLECharacteristicValueChange(this.bleValueHandler);
      this.bleValueHandler = null;
    }
    if (this.bleConnectionStateHandler && wx.offBLEConnectionStateChange) {
      wx.offBLEConnectionStateChange(this.bleConnectionStateHandler);
      this.bleConnectionStateHandler = null;
    }
    this.heartRateCharacteristicId = "";
    if (this.data.connectedDeviceId) {
      wx.closeBLEConnection({ deviceId: this.data.connectedDeviceId, fail: () => {} });
    }
    wx.setKeepScreenOn({ keepScreenOn: false, fail: () => {} });
  },

  getSetMeasureType(set) {
    if (set?.measureType === "duration" || set?.durationSeconds != null) return "duration";
    return "reps";
  },

  getSetMetricValue(set) {
    return this.getSetMeasureType(set) === "duration"
      ? Number(set.durationSeconds ?? set.reps) || 0
      : Number(set.reps) || 0;
  },

  getFarmerTimingFields(set) {
    if (set?.trackingMode !== "farmer_sides") return {};
    return {
      trackingMode: "farmer_sides",
      leftDurationSeconds: Number(set.leftDurationSeconds) || 0,
      rightDurationSeconds: Number(set.rightDurationSeconds) || 0,
      leftStartedAt: Number(set.leftStartedAt) || null,
      leftEndedAt: Number(set.leftEndedAt) || null,
      rightStartedAt: Number(set.rightStartedAt) || null,
      rightEndedAt: Number(set.rightEndedAt) || null,
    };
  },

  normalizeWorkoutSets(sets) {
    return (sets || []).map((set) => {
      const measureType = this.getSetMeasureType(set);
      const metricValue = this.getSetMetricValue(set);
      return {
        ...set,
        measureType,
        reps: metricValue,
        ...(measureType === "duration" ? { durationSeconds: metricValue } : {}),
      };
    });
  },

  calculateVolume(sets) {
    return Math.round(sets.reduce((sum, item) => (
      this.getSetMeasureType(item) === "duration"
        ? sum
        : sum + Number(item.weight) * this.getSetMetricValue(item)
    ), 0));
  },

  refreshWorkoutDay() {
    const currentDateKey = todayKey();
    if (this.workoutDateKey === currentDateKey) return this.data.sets;
    const sets = this.normalizeWorkoutSets(
      wx.getStorageSync(`workout_${currentDateKey}`) || [],
    );
    const date = new Date();
    this.workoutDateKey = currentDateKey;
    this.setData({
      dateLabel: `${date.getMonth() + 1}月${date.getDate()}日`,
      sets,
      totalVolume: this.calculateVolume(sets),
    });
    return sets;
  },

  normalizeExerciseLibrary(source) {
    const names = new Set();
    const ids = new Set();
    return (Array.isArray(source) ? source : []).reduce((result, rawItem) => {
      const item = typeof rawItem === "string" ? { name: rawItem } : rawItem;
      const name = String(item?.name || "").trim();
      if (!name || names.has(name)) return result;
      let id = String(item.id || createId("exercise"));
      while (ids.has(id)) id = createId("exercise");
      names.add(name);
      ids.add(id);
      const defaultExercise = DEFAULT_EXERCISES.find((exercise) => (
        exercise.id === id || exercise.name === name
      ));
      result.push({
        id,
        name,
        group: MUSCLE_GROUPS.includes(item.group) ? item.group : "其他",
        favorite: Boolean(item.favorite),
        archived: Boolean(item.archived),
        measureType: id === "farmer_walk"
          ? "duration"
          : normalizeMeasureType(item.measureType || defaultExercise?.measureType),
      });
      return result;
    }, []);
  },

  loadExerciseLibrary() {
    const stored = wx.getStorageSync(EXERCISE_LIBRARY_KEY);
    let source = Array.isArray(stored) && stored.length
      ? stored.map((item) => ({ ...item }))
      : DEFAULT_EXERCISES.map((item) => ({ ...item, archived: false }));
    DEFAULT_EXERCISES.forEach((defaultExercise) => {
      if (!source.some((item) => item.id === defaultExercise.id || item.name === defaultExercise.name)) {
        source.push({ ...defaultExercise, archived: false });
      }
    });
    if (!(Array.isArray(stored) && stored.length)) {
      const legacy = wx.getStorageSync("recent_exercises") || [];
      legacy.forEach((name) => {
        if (!source.some((item) => item.name === name)) {
          source.push({
            id: createId("exercise"),
            name,
            group: "其他",
            favorite: true,
            archived: false,
            measureType: "reps",
          });
        }
      });
    }
    const library = this.normalizeExerciseLibrary(source);
    if (!Array.isArray(stored) || JSON.stringify(stored) !== JSON.stringify(library)) {
      this.persistExerciseLibrary(library);
    }
    return library;
  },

  persistExerciseLibrary(library) {
    try {
      wx.setStorageSync(EXERCISE_LIBRARY_KEY, library);
      wx.setStorageSync("recent_exercises", this.getQuickExercises(library).map((item) => item.name));
      return true;
    } catch (error) {
      return false;
    }
  },

  getQuickExercises(library) {
    const active = (library || []).filter((item) => !item.archived);
    const favorites = active.filter((item) => item.favorite);
    const others = active.filter((item) => !item.favorite);
    return [...favorites, ...others].slice(0, 6);
  },

  loadWorkoutTemplates() {
    const stored = wx.getStorageSync(WORKOUT_TEMPLATES_KEY);
    if (!Array.isArray(stored)) return [];
    return stored.filter((template) => (
      template && template.id && template.name && Array.isArray(template.exercises) && template.exercises.length
    ));
  },

  getExerciseStorageKey(exerciseId, exerciseName) {
    return exerciseId || `name:${String(exerciseName || "").trim()}`;
  },

  findLastPerformance(exerciseId, exerciseName) {
    return this.lastPerformanceMap?.[this.getExerciseStorageKey(exerciseId, exerciseName)]
      || this.lastPerformanceMap?.[`name:${String(exerciseName || "").trim()}`]
      || null;
  },

  rebuildLastPerformanceIndex(library = this.data.exerciseLibrary) {
    const index = {};
    let keys = [];
    try {
      keys = wx.getStorageInfoSync?.().keys || [];
    } catch (error) {
      keys = [];
    }
    keys.filter((key) => /^workout_\d{4}-\d{2}-\d{2}$/.test(key)).sort().forEach((key) => {
      const dateKey = key.replace("workout_", "");
      const sets = wx.getStorageSync(key) || [];
      const counts = {};
      sets.forEach((set) => {
        const exercise = library.find((item) => item.id === set.exerciseId || item.name === set.exerciseName);
        const storageKey = this.getExerciseStorageKey(exercise?.id || set.exerciseId, set.exerciseName);
        counts[storageKey] = (counts[storageKey] || 0) + 1;
      });
      [...sets].reverse().forEach((set) => {
        const exercise = library.find((item) => item.id === set.exerciseId || item.name === set.exerciseName);
        const exerciseId = exercise?.id || set.exerciseId || "";
        const measureType = this.getSetMeasureType(set);
        const metricValue = this.getSetMetricValue(set);
        const performance = {
          exerciseId,
          exerciseName: set.exerciseName,
          measureType,
          weight: Number(set.weight) || 0,
          reps: metricValue,
          ...(measureType === "duration" ? { durationSeconds: metricValue } : {}),
          restSeconds: Math.max(15, Number(set.restSeconds) || 90),
          dateKey,
          time: set.time || "",
          setsCount: counts[this.getExerciseStorageKey(exerciseId, set.exerciseName)] || 1,
          ...this.getFarmerTimingFields(set),
        };
        index[this.getExerciseStorageKey(exerciseId, set.exerciseName)] = performance;
        index[`name:${set.exerciseName}`] = performance;
      });
    });
    try {
      wx.setStorageSync(LAST_PERFORMANCE_KEY, index);
    } catch (error) {
      // 辅助索引写入失败时仍返回内存结果，不能阻断训练主流程。
    }
    return index;
  },

  migrateStoredWorkoutExerciseIds(library = this.data.exerciseLibrary) {
    const exerciseIdByName = library.reduce((result, item) => {
      result[item.name] = item.id;
      return result;
    }, {});
    let keys = [];
    try {
      keys = wx.getStorageInfoSync?.().keys || [];
    } catch (error) {
      return false;
    }
    let saved = true;
    keys.filter((key) => /^workout_\d{4}-\d{2}-\d{2}$/.test(key)).forEach((key) => {
      const sets = wx.getStorageSync(key) || [];
      let changed = false;
      const migratedSets = sets.map((set) => {
        if (set.exerciseId || !exerciseIdByName[set.exerciseName]) return set;
        changed = true;
        return { ...set, exerciseId: exerciseIdByName[set.exerciseName] };
      });
      if (changed) {
        try {
          wx.setStorageSync(key, migratedSets);
        } catch (error) {
          saved = false;
        }
      }
    });
    return saved;
  },

  updateLastPerformance(set, sets) {
    const storageKey = this.getExerciseStorageKey(set.exerciseId, set.exerciseName);
    const measureType = this.getSetMeasureType(set);
    const metricValue = this.getSetMetricValue(set);
    const performance = {
      exerciseId: set.exerciseId || "",
      exerciseName: set.exerciseName,
      measureType,
      weight: Number(set.weight) || 0,
      reps: metricValue,
      ...(measureType === "duration" ? { durationSeconds: metricValue } : {}),
      restSeconds: Math.max(15, Number(set.restSeconds) || 90),
      dateKey: set.dateKey,
      time: set.time,
      setsCount: sets.filter((item) => (
        this.getExerciseStorageKey(item.exerciseId, item.exerciseName) === storageKey
      )).length,
      ...this.getFarmerTimingFields(set),
    };
    this.lastPerformanceMap = {
      ...(this.lastPerformanceMap || {}),
      [storageKey]: performance,
      [`name:${set.exerciseName}`]: performance,
    };
    try {
      wx.setStorageSync(LAST_PERFORMANCE_KEY, this.lastPerformanceMap);
    } catch (error) {
      // 原始训练组已经保存，缓存失败时继续进入休息页。
    }
    this.setData({ lastPerformance: performance });
    return performance;
  },

  refreshLastPerformanceForExercise(exerciseId, exerciseName) {
    const resolvedExerciseId = exerciseId || this.data.exerciseLibrary.find(
      (item) => item.name === exerciseName,
    )?.id || "";
    const storageKey = this.getExerciseStorageKey(resolvedExerciseId, exerciseName);
    const nextIndex = { ...(this.lastPerformanceMap || {}) };
    delete nextIndex[storageKey];
    delete nextIndex[`name:${exerciseName}`];
    this.lastPerformanceMap = nextIndex;

    let keys = [];
    try {
      keys = wx.getStorageInfoSync?.().keys || [];
    } catch (error) {
      keys = [];
    }
    const workoutKeys = keys
      .filter((key) => /^workout_\d{4}-\d{2}-\d{2}$/.test(key))
      .sort()
      .reverse();
    for (const key of workoutKeys) {
      const sets = wx.getStorageSync(key) || [];
      const latest = sets.find((set) => (
        (resolvedExerciseId && set.exerciseId === resolvedExerciseId)
        || set.exerciseName === exerciseName
      ));
      if (latest) {
        return this.updateLastPerformance({
          ...latest,
          dateKey: latest.dateKey || key.replace("workout_", ""),
        }, sets);
      }
    }

    try {
      wx.setStorageSync(LAST_PERFORMANCE_KEY, this.lastPerformanceMap);
    } catch (error) {
      // 删除训练组已经成功，辅助索引失败时不回滚原始记录。
    }
    return null;
  },

  emptyHeartMeta() {
    return { chunkIndex: 0, count: 0, sum: 0, min: null, max: null };
  },

  loadHeartStorage(dateKey) {
    this.heartDateKey = dateKey;
    this.heartStorageBase = `heart_rate_${dateKey}`;
    this.heartWriteChain = this.heartWriteChain || Promise.resolve();
    this.heartStorageDirty = false;
    this.pendingChunkSamples = 0;

    const storedMeta = wx.getStorageSync(`${this.heartStorageBase}_meta`);
    if (storedMeta && Number.isFinite(Number(storedMeta.count))) {
      this.heartMeta = {
        chunkIndex: Number(storedMeta.chunkIndex) || 0,
        count: Number(storedMeta.count) || 0,
        sum: Number(storedMeta.sum) || 0,
        min: storedMeta.min == null ? null : Number(storedMeta.min),
        max: storedMeta.max == null ? null : Number(storedMeta.max),
      };
      this.heartChunk = wx.getStorageSync(`${this.heartStorageBase}_${this.heartMeta.chunkIndex}`) || [];
      return this.getHeartStats();
    }

    // 兼容旧版单键数组；迁移后保留旧键，避免异常中断导致数据丢失。
    const legacySamples = wx.getStorageSync(this.heartStorageBase) || [];
    const validLegacy = legacySamples.filter((sample) => Array.isArray(sample) && Number(sample[1]) > 0);
    this.heartMeta = this.emptyHeartMeta();
    validLegacy.forEach((sample) => this.addHeartRateToMeta(Number(sample[1])));

    const chunks = [];
    for (let index = 0; index < validLegacy.length; index += HEART_RATE_CHUNK_SIZE) {
      chunks.push(validLegacy.slice(index, index + HEART_RATE_CHUNK_SIZE));
    }
    chunks.forEach((chunk, index) => {
      this.queueStorageWrite(`${this.heartStorageBase}_${index}`, chunk);
    });

    if (chunks.length && chunks[chunks.length - 1].length < HEART_RATE_CHUNK_SIZE) {
      this.heartMeta.chunkIndex = chunks.length - 1;
      this.heartChunk = [...chunks[chunks.length - 1]];
    } else {
      this.heartMeta.chunkIndex = chunks.length;
      this.heartChunk = [];
    }
    if (validLegacy.length) {
      this.queueStorageWrite(`${this.heartStorageBase}_meta`, { ...this.heartMeta });
    }
    return this.getHeartStats();
  },

  checkHeartStoragePressure() {
    if (this.heartStoragePressurePrompted) return;
    let storageInfo;
    try {
      storageInfo = wx.getStorageInfoSync?.();
    } catch (error) {
      return;
    }
    const currentSize = Number(storageInfo?.currentSize) || 0;
    const limitSize = Number(storageInfo?.limitSize) || 0;
    if (!limitSize || currentSize / limitSize < HEART_STORAGE_WARNING_RATIO) return;

    this.heartStoragePressurePrompted = true;
    wx.showModal({
      title: "心率存储空间不足",
      content: `本机存储已使用 ${Math.round((currentSize / limitSize) * 100)}%。是否清理 ${HEART_RATE_RETENTION_DAYS} 天前的原始心率？训练组、重量和次数不会删除。`,
      confirmText: "清理",
      success: (result) => {
        if (!result.confirm) return;
        const removedDays = this.cleanupOldHeartRateStorage(HEART_RATE_RETENTION_DAYS);
        wx.showToast({
          title: removedDays ? `已清理 ${removedDays} 天心率` : "没有可清理的旧心率",
          icon: "none",
        });
      },
    });
  },

  cleanupOldHeartRateStorage(retentionDays) {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - Math.max(1, Number(retentionDays) || 1));
    const cutoffKey = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`;
    let keys = [];
    try {
      keys = wx.getStorageInfoSync?.().keys || [];
    } catch (error) {
      return 0;
    }
    const removedDates = new Set();
    keys.forEach((key) => {
      const match = /^heart_rate_(\d{4}-\d{2}-\d{2})(?:_|$)/.exec(key);
      if (!match || match[1] >= cutoffKey) return;
      try {
        wx.removeStorageSync(key);
        removedDates.add(match[1]);
      } catch (error) {
        // 单个键删除失败时继续尝试其他旧心率分块。
      }
    });
    return removedDates.size;
  },

  notifyHeartStorageFailure() {
    if (this.heartStorageFailureNotified) return;
    this.heartStorageFailureNotified = true;
    wx.showToast({ title: "心率存储失败，请清理空间", icon: "none" });
  },

  addHeartRateToMeta(heartRate) {
    const rate = Number(heartRate);
    this.heartMeta.count += 1;
    this.heartMeta.sum += rate;
    this.heartMeta.min = this.heartMeta.min == null ? rate : Math.min(this.heartMeta.min, rate);
    this.heartMeta.max = this.heartMeta.max == null ? rate : Math.max(this.heartMeta.max, rate);
  },

  getHeartStats() {
    const count = Number(this.heartMeta?.count) || 0;
    return {
      heartSampleCount: count,
      heartAverage: count ? Math.round(this.heartMeta.sum / count) : "--",
      heartMaximum: count ? this.heartMeta.max : "--",
      heartMinimum: count ? this.heartMeta.min : "--",
    };
  },

  setStorageAsync(key, data) {
    return new Promise((resolve, reject) => {
      wx.setStorage({ key, data, success: resolve, fail: reject });
    });
  },

  queueStorageWrite(key, data) {
    const snapshot = Array.isArray(data) ? [...data] : { ...data };
    this.heartWriteChain = (this.heartWriteChain || Promise.resolve())
      .then(() => this.setStorageAsync(key, snapshot))
      .then(() => {
        if (this.failedHeartWrites) delete this.failedHeartWrites[key];
      })
      .catch(() => {
        this.heartStorageDirty = true;
        this.failedHeartWrites = {
          ...(this.failedHeartWrites || {}),
          [key]: snapshot,
        };
        this.notifyHeartStorageFailure();
      });
    return this.heartWriteChain;
  },

  flushHeartStorage() {
    const failedEntries = Object.entries(this.failedHeartWrites || {});
    if ((!this.heartStorageDirty && !failedEntries.length) || !this.heartStorageBase) {
      return this.heartWriteChain || Promise.resolve();
    }
    const chunkKey = `${this.heartStorageBase}_${this.heartMeta.chunkIndex}`;
    const chunk = [...this.heartChunk];
    const meta = { ...this.heartMeta };
    this.heartStorageDirty = false;
    this.pendingChunkSamples = 0;
    failedEntries.forEach(([failedKey, failedData]) => {
      this.queueStorageWrite(failedKey, failedData);
    });
    this.queueStorageWrite(chunkKey, chunk);
    return this.queueStorageWrite(`${this.heartStorageBase}_meta`, meta);
  },

  saveHeartSamples() {
    return this.flushHeartStorage();
  },

  recordHeartRate(heartRate) {
    const currentDateKey = todayKey();
    if (this.heartDateKey !== currentDateKey) {
      this.flushHeartStorage();
      const stats = this.loadHeartStorage(currentDateKey);
      this.setData(stats);
    }

    if (this.heartChunk.length >= HEART_RATE_CHUNK_SIZE) {
      const completedIndex = this.heartMeta.chunkIndex;
      const completedChunk = [...this.heartChunk];
      this.queueStorageWrite(`${this.heartStorageBase}_${completedIndex}`, completedChunk);
      this.heartMeta.chunkIndex += 1;
      this.heartChunk = [];
      this.pendingChunkSamples = 0;
    }

    const sampledAt = Date.now();
    this.heartChunk.push([sampledAt, Number(heartRate)]);
    this.addHeartRateToMeta(heartRate);
    this.heartStorageDirty = true;
    this.pendingChunkSamples += 1;

    const displayUpdate = {
      heartRate: Number(heartRate),
      heartStatus: "心率实时记录中",
      ...this.getHeartStats(),
    };
    if (this.data.mode === "rest") {
      this.restHeartPoints = [...(this.restHeartPoints || []), [sampledAt, Number(heartRate)]];
      Object.assign(displayUpdate, this.getRecoveryUpdate(heartRate));
    }
    this.queueHeartDisplay(displayUpdate);

    if (this.pendingChunkSamples >= HEART_STORAGE_BATCH_SIZE) {
      this.flushHeartStorage();
    }
  },

  queueHeartDisplay(update) {
    this.pendingHeartDisplay = { ...(this.pendingHeartDisplay || {}), ...update };
    const now = Date.now();
    const elapsed = now - (this.lastHeartDisplayAt || 0);
    if (elapsed >= HEART_DISPLAY_INTERVAL_MS) {
      this.flushHeartDisplay();
      return;
    }
    if (!this.heartDisplayTimer) {
      this.heartDisplayTimer = setTimeout(() => this.flushHeartDisplay(), HEART_DISPLAY_INTERVAL_MS - elapsed);
    }
  },

  flushHeartDisplay() {
    if (this.heartDisplayTimer) {
      clearTimeout(this.heartDisplayTimer);
      this.heartDisplayTimer = null;
    }
    if (!this.pendingHeartDisplay) return;
    const update = this.pendingHeartDisplay;
    this.pendingHeartDisplay = null;
    this.lastHeartDisplayAt = Date.now();
    this.setData(update, () => {
      if (this.data.mode === "rest") this.drawHeartSparkline();
    });
  },

  clearPendingHeartDisplay() {
    if (this.heartDisplayTimer) clearTimeout(this.heartDisplayTimer);
    this.heartDisplayTimer = null;
    this.pendingHeartDisplay = null;
  },

  hasFarmerTimingProgress() {
    return Boolean(
      this.data.farmerActiveSide
      || Number(this.data.farmerLeftDurationMs)
      || Number(this.data.farmerRightDurationMs),
    );
  },

  guardFarmerTimingProgress() {
    if (!this.hasFarmerTimingProgress()) return false;
    wx.showToast({ title: "请先保存或清空本组", icon: "none" });
    return true;
  },

  isFarmerWeightLocked() {
    return this.data.exerciseId === "farmer_walk" && this.hasFarmerTimingProgress();
  },

  clearFarmerTimer() {
    if (this.farmerTimer) {
      clearInterval(this.farmerTimer);
      this.farmerTimer = null;
    }
  },

  syncFarmerTimer() {
    const side = this.data.farmerActiveSide;
    if (!side || !this.farmerStartedAt) return;
    const textKey = side === "left" ? "farmerLeftText" : "farmerRightText";
    const text = formatStopwatch(Date.now() - this.farmerStartedAt);
    if (text !== this.data[textKey]) this.setData({ [textKey]: text });
  },

  startFarmerTicker() {
    this.clearFarmerTimer();
    this.syncFarmerTimer();
    if (!this.data.farmerActiveSide || !this.farmerStartedAt) return;
    this.farmerTimer = setInterval(() => this.syncFarmerTimer(), 100);
  },

  resetFarmerTiming() {
    this.clearFarmerTimer();
    this.farmerStartedAt = null;
    this.farmerSideStartedAt = {};
    this.farmerSideEndedAt = {};
    this.setData({
      farmerActiveSide: "",
      farmerLeftDurationMs: 0,
      farmerRightDurationMs: 0,
      farmerLeftText: "00:00.0",
      farmerRightText: "00:00.0",
    });
  },

  resetFarmerTimingFromUI() {
    if (!this.hasFarmerTimingProgress()) return;
    wx.showModal({
      title: "清空本组计时？",
      content: "左右手尚未保存的时长将被清空。",
      success: (result) => {
        if (result.confirm) this.resetFarmerTiming();
      },
    });
  },

  toggleFarmerSide(event) {
    if (this.data.mode !== "training" || this.data.exerciseId !== "farmer_walk") return;
    const side = event.currentTarget.dataset.side;
    if (!["left", "right"].includes(side)) return;
    if (this.data.farmerActiveSide && this.data.farmerActiveSide !== side) {
      wx.showToast({ title: "请先结束当前一侧", icon: "none" });
      return;
    }

    if (this.data.farmerActiveSide === side) {
      const endedAt = Date.now();
      if (endedAt - this.farmerStartedAt < 500) return;
      const durationMs = Math.max(100, endedAt - this.farmerStartedAt);
      const durationKey = side === "left" ? "farmerLeftDurationMs" : "farmerRightDurationMs";
      const textKey = side === "left" ? "farmerLeftText" : "farmerRightText";
      this.farmerSideEndedAt = { ...(this.farmerSideEndedAt || {}), [side]: endedAt };
      this.farmerStartedAt = null;
      this.clearFarmerTimer();
      this.setData({
        farmerActiveSide: "",
        [durationKey]: durationMs,
        [textKey]: formatStopwatch(durationMs),
      });
      wx.vibrateShort({ type: "medium" });
      return;
    }

    const startedAt = Date.now();
    const durationKey = side === "left" ? "farmerLeftDurationMs" : "farmerRightDurationMs";
    const textKey = side === "left" ? "farmerLeftText" : "farmerRightText";
    this.farmerStartedAt = startedAt;
    this.farmerSideStartedAt = { ...(this.farmerSideStartedAt || {}), [side]: startedAt };
    this.farmerSideEndedAt = { ...(this.farmerSideEndedAt || {}), [side]: null };
    this.setData({
      farmerActiveSide: side,
      [durationKey]: 0,
      [textKey]: "00:00.0",
    }, () => this.startFarmerTicker());
    wx.vibrateShort({ type: "light" });
  },

  onFieldInput(event) {
    const key = event.currentTarget.dataset.key;
    if (key === "weight" && this.isFarmerWeightLocked()) {
      wx.showToast({ title: "计时开始后重量已锁定", icon: "none" });
      return;
    }
    if (key === "exerciseName") {
      if (this.guardFarmerTimingProgress()) return;
      this.setData({
        exerciseName: event.detail.value,
        exerciseId: "",
        measureType: "reps",
        lastPerformance: null,
        activeTemplateIndex: -1,
      });
      return;
    }
    this.setData({ [key]: event.detail.value });
  },

  onFieldBlur(event) {
    const key = event.currentTarget.dataset.key;
    if (key === "exerciseName") {
      const exerciseName = String(this.data.exerciseName).trim();
      const exercise = this.data.exerciseLibrary.find((item) => !item.archived && item.name === exerciseName);
      const performance = this.findLastPerformance(exercise?.id, exerciseName);
      const measureType = normalizeMeasureType(exercise?.measureType);
      if ((exercise?.id || "") !== this.data.exerciseId) this.resetFarmerTiming();
      const update = {
        exerciseName,
        exerciseId: exercise?.id || "",
        measureType,
        lastPerformance: performance,
        activeTemplateIndex: this.data.activeTemplateExercises.findIndex((item) => (
          item.exerciseId === exercise?.id || (!item.exerciseId && item.exerciseName === exerciseName)
        )),
      };
      if (performance) {
        const restSeconds = Math.max(15, Number(performance?.restSeconds) || Number(this.data.restSeconds) || 90);
        Object.assign(update, {
          weight: String(performance.weight),
          reps: String(performance.measureType === measureType
            ? performance.reps
            : defaultMetricValue(measureType)),
          restSeconds: String(restSeconds),
          timerRemaining: restSeconds,
          timerText: formatClock(restSeconds),
        });
      } else if (this.data.measureType !== measureType) {
        update.reps = String(defaultMetricValue(measureType));
      }
      this.setData(update, () => this.saveConfig());
      return;
    }

    let value = Number(this.data[key]);
    if (!Number.isFinite(value)) value = 0;
    if (key === "weight") value = Math.max(0, Math.round(value * 10) / 10);
    if (key === "reps") value = Math.max(0, Math.round(value));
    if (key === "restSeconds") value = Math.max(15, Math.round(value || 90));

    this.setData({ [key]: String(value) }, () => {
      this.saveConfig();
      if (key === "restSeconds" && this.data.mode === "training" && !this.data.timerRunning) {
        this.setData({ timerRemaining: value, timerText: formatClock(value) });
      }
    });
  },

  saveConfig(overrides = {}) {
    const next = { ...this.data, ...overrides };
    try {
      wx.setStorageSync("workout_config", {
        exerciseId: next.exerciseId || "",
        exerciseName: String(next.exerciseName).trim(),
        measureType: normalizeMeasureType(next.measureType),
        weight: Number(next.weight) || 0,
        reps: Number(next.reps) || 0,
        restSeconds: Math.max(15, Number(next.restSeconds) || 90),
      });
    } catch (error) {
      // 配置是辅助数据，保存失败不能中断正在进行的训练。
    }
  },

  selectExercise(event) {
    const exercise = this.data.exerciseLibrary.find((item) => (
      item.id === event.currentTarget.dataset.id && !item.archived
    ));
    if (!exercise) return;
    if (exercise.id !== this.data.exerciseId && this.guardFarmerTimingProgress()) return;
    if (exercise.id !== this.data.exerciseId) this.resetFarmerTiming();
    const performance = this.findLastPerformance(exercise.id, exercise.name);
    const measureType = normalizeMeasureType(exercise.measureType);
    const restSeconds = performance?.restSeconds ?? (Number(this.data.restSeconds) || 90);
    const update = {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      measureType,
      lastPerformance: performance,
      activeTemplateIndex: this.data.activeTemplateExercises.findIndex((item) => (
        item.exerciseId === exercise.id || (!item.exerciseId && item.exerciseName === exercise.name)
      )),
      timerRemaining: Math.max(15, Number(restSeconds) || 90),
      timerText: formatClock(Math.max(15, Number(restSeconds) || 90)),
    };
    if (performance) {
      update.weight = String(performance.weight);
      update.reps = String(performance.measureType === measureType
        ? performance.reps
        : defaultMetricValue(measureType));
      update.restSeconds = String(performance.restSeconds);
    } else if (this.data.measureType !== measureType) {
      update.reps = String(defaultMetricValue(measureType));
    }
    this.setData(update, () => this.saveConfig());
  },

  ensureExerciseInLibrary(exerciseName, preferredId = this.data.exerciseId) {
    const name = String(exerciseName || "").trim();
    let library = this.data.exerciseLibrary.map((item) => ({ ...item }));
    let exercise = library.find((item) => item.id === preferredId)
      || library.find((item) => item.name === name);
    if (exercise?.archived) {
      library = library.map((item) => item.id === exercise.id ? { ...item, archived: false } : item);
      exercise = library.find((item) => item.id === exercise.id);
    }
    if (!exercise) {
      exercise = {
        id: createId("exercise"),
        name,
        group: "其他",
        favorite: true,
        archived: false,
        measureType: "reps",
      };
      library = [exercise, ...library];
    }
    this.persistExerciseLibrary(library);
    this.setData({ exerciseLibrary: library, quickExercises: this.getQuickExercises(library) });
    return exercise;
  },

  filterDraftExercises(drafts, mode = this.data.libraryMode, group = this.data.libraryGroup) {
    return drafts.filter((item) => {
      const matchesMode = mode === "archived"
        ? item.archived
        : !item.archived && (mode !== "favorites" || item.favorite);
      return matchesMode && (group === "全部" || item.group === group);
    });
  },

  refreshExerciseDraftView(
    drafts = this.data.draftExercises,
    mode = this.data.libraryMode,
    group = this.data.libraryGroup,
  ) {
    this.setData({
      draftExercises: drafts,
      libraryMode: mode,
      libraryGroup: group,
      filteredDraftExercises: this.filterDraftExercises(drafts, mode, group),
    });
  },

  openExerciseManager() {
    if (this.guardFarmerTimingProgress()) return;
    const draftExercises = this.data.exerciseLibrary.map((item) => ({
      ...item,
      groupIndex: Math.max(0, MUSCLE_GROUPS.indexOf(item.group)),
      measureTypeIndex: MEASURE_TYPES.findIndex((type) => type.value === item.measureType),
    }));
    this.setData({
      showExerciseManager: true,
      draftExercises,
      filteredDraftExercises: this.filterDraftExercises(draftExercises, "favorites", "全部"),
      libraryMode: "favorites",
      libraryGroup: "全部",
      newExerciseName: "",
      newExerciseGroup: "其他",
      newExerciseGroupIndex: MUSCLE_GROUPS.length - 1,
      newExerciseMeasureType: "reps",
      newExerciseMeasureTypeIndex: 0,
    });
  },

  closeExerciseManager() {
    this.setData({
      showExerciseManager: false,
      newExerciseName: "",
      newExerciseGroup: "其他",
      newExerciseGroupIndex: MUSCLE_GROUPS.length - 1,
      newExerciseMeasureType: "reps",
      newExerciseMeasureTypeIndex: 0,
    });
  },

  onLibraryMode(event) {
    this.refreshExerciseDraftView(
      this.data.draftExercises,
      event.currentTarget.dataset.mode,
      this.data.libraryGroup,
    );
  },

  onLibraryGroup(event) {
    this.refreshExerciseDraftView(
      this.data.draftExercises,
      this.data.libraryMode,
      event.currentTarget.dataset.group,
    );
  },

  onExerciseOptionInput(event) {
    const id = event.currentTarget.dataset.id;
    const draftExercises = this.data.draftExercises.map((item) => (
      item.id === id ? { ...item, name: event.detail.value } : item
    ));
    this.refreshExerciseDraftView(draftExercises);
  },

  toggleExerciseFavorite(event) {
    const id = event.currentTarget.dataset.id;
    const draftExercises = this.data.draftExercises.map((item) => (
      item.id === id ? { ...item, favorite: !item.favorite } : item
    ));
    this.refreshExerciseDraftView(draftExercises);
  },

  onExerciseGroupChange(event) {
    const id = event.currentTarget.dataset.id;
    const groupIndex = Number(event.detail.value);
    const group = MUSCLE_GROUPS[groupIndex] || "其他";
    const draftExercises = this.data.draftExercises.map((item) => (
      item.id === id ? { ...item, group, groupIndex } : item
    ));
    this.refreshExerciseDraftView(draftExercises);
  },

  onExerciseMeasureTypeChange(event) {
    const id = event.currentTarget.dataset.id;
    if (id === "farmer_walk") return;
    const measureTypeIndex = Number(event.detail.value);
    const measureType = MEASURE_TYPES[measureTypeIndex]?.value || "reps";
    const draftExercises = this.data.draftExercises.map((item) => (
      item.id === id ? { ...item, measureType, measureTypeIndex } : item
    ));
    this.refreshExerciseDraftView(draftExercises);
  },

  toggleExerciseArchive(event) {
    const id = event.currentTarget.dataset.id;
    const draftExercises = this.data.draftExercises.map((item) => (
      item.id === id ? { ...item, archived: !item.archived } : item
    ));
    this.refreshExerciseDraftView(draftExercises);
  },

  onNewExerciseInput(event) {
    this.setData({ newExerciseName: event.detail.value });
  },

  onNewExerciseGroupChange(event) {
    const newExerciseGroupIndex = Number(event.detail.value);
    this.setData({
      newExerciseGroup: MUSCLE_GROUPS[newExerciseGroupIndex] || "其他",
      newExerciseGroupIndex,
    });
  },

  onNewExerciseMeasureTypeChange(event) {
    const newExerciseMeasureTypeIndex = Number(event.detail.value);
    this.setData({
      newExerciseMeasureType: MEASURE_TYPES[newExerciseMeasureTypeIndex]?.value || "reps",
      newExerciseMeasureTypeIndex,
    });
  },

  addExerciseOption() {
    const exerciseName = String(this.data.newExerciseName).trim();
    if (!exerciseName) {
      wx.showToast({ title: "请输入动作名称", icon: "none" });
      return;
    }
    const existing = this.data.draftExercises.map((item) => String(item.name).trim());
    if (existing.includes(exerciseName)) {
      wx.showToast({ title: "这个动作已经存在", icon: "none" });
      return;
    }
    const draftExercises = [
      {
        id: createId("exercise"),
        name: exerciseName,
        group: this.data.newExerciseGroup,
        groupIndex: this.data.newExerciseGroupIndex,
        measureType: this.data.newExerciseMeasureType,
        measureTypeIndex: this.data.newExerciseMeasureTypeIndex,
        favorite: true,
        archived: false,
      },
      ...this.data.draftExercises,
    ];
    this.setData({
      newExerciseName: "",
      newExerciseGroup: "其他",
      newExerciseGroupIndex: MUSCLE_GROUPS.length - 1,
      newExerciseMeasureType: "reps",
      newExerciseMeasureTypeIndex: 0,
    }, () => this.refreshExerciseDraftView(draftExercises, "favorites", "全部"));
  },

  saveExerciseOptions() {
    const names = new Set();
    const duplicate = this.data.draftExercises.some((item) => {
      const name = String(item.name).trim();
      if (!name || names.has(name)) return true;
      names.add(name);
      return false;
    });
    if (duplicate) {
      wx.showToast({ title: "动作名称不能为空或重复", icon: "none" });
      return;
    }
    const exerciseLibrary = this.normalizeExerciseLibrary(this.data.draftExercises);
    const activeExercises = exerciseLibrary.filter((item) => !item.archived);
    if (!activeExercises.length) {
      wx.showToast({ title: "至少保留一个可用动作", icon: "none" });
      return;
    }
    const previousCurrent = this.data.exerciseLibrary.find((item) => item.id === this.data.exerciseId);
    const current = exerciseLibrary.find((item) => item.id === this.data.exerciseId);
    const selected = current && !current.archived ? current : activeExercises[0];
    const templates = this.data.templates.map((template) => ({
      ...template,
      exercises: template.exercises.map((item) => {
        const exercise = exerciseLibrary.find((candidate) => candidate.id === item.exerciseId);
        const measureType = normalizeMeasureType(exercise?.measureType || item.measureType);
        const previousMeasureType = normalizeMeasureType(item.measureType);
        const metricValue = previousMeasureType === measureType
          ? Number(item.durationSeconds ?? item.reps) || defaultMetricValue(measureType)
          : defaultMetricValue(measureType);
        return {
          ...item,
          exerciseName: exercise?.name || item.exerciseName,
          measureType,
          reps: metricValue,
          durationSeconds: measureType === "duration" ? metricValue : null,
        };
      }),
    }));
    const historyMigrated = this.migrateStoredWorkoutExerciseIds(this.data.exerciseLibrary);
    const librarySaved = historyMigrated && this.persistExerciseLibrary(exerciseLibrary);
    let templatesSaved = librarySaved;
    if (librarySaved) {
      try {
        wx.setStorageSync(WORKOUT_TEMPLATES_KEY, templates);
      } catch (error) {
        templatesSaved = false;
      }
    }
    const committedLibrary = librarySaved ? exerciseLibrary : this.data.exerciseLibrary;
    const committedTemplates = templatesSaved ? templates : this.data.templates;
    this.lastPerformanceMap = this.rebuildLastPerformanceIndex(committedLibrary);
    const update = {
      exerciseLibrary: committedLibrary,
      quickExercises: this.getQuickExercises(committedLibrary),
      templates: committedTemplates,
      sets: this.normalizeWorkoutSets(
        wx.getStorageSync(`workout_${this.workoutDateKey || todayKey()}`) || this.data.sets,
      ),
      showExerciseManager: !librarySaved,
      newExerciseName: "",
      newExerciseGroup: "其他",
      newExerciseGroupIndex: MUSCLE_GROUPS.length - 1,
      newExerciseMeasureType: "reps",
      newExerciseMeasureTypeIndex: 0,
    };
    if (current && librarySaved) {
      const performance = this.findLastPerformance(selected.id, selected.name);
      update.exerciseId = selected.id;
      update.exerciseName = selected.name;
      update.measureType = normalizeMeasureType(selected.measureType);
      update.lastPerformance = performance;
      const selectionChanged = selected.id !== previousCurrent?.id
        || selected.measureType !== previousCurrent?.measureType;
      if (selectionChanged) {
        const restSeconds = Math.max(15, Number(performance?.restSeconds) || Number(this.data.restSeconds) || 90);
        Object.assign(update, {
          weight: String(performance?.weight ?? this.data.weight),
          reps: String(performance?.measureType === selected.measureType
            ? performance.reps
            : defaultMetricValue(selected.measureType)),
          restSeconds: String(restSeconds),
          timerRemaining: restSeconds,
          timerText: formatClock(restSeconds),
        });
      }
    }
    this.setData(update, () => this.saveConfig());
    wx.showToast({
      title: !librarySaved
        ? "存储空间不足，请清理后重试"
        : (templatesSaved ? "动作库已保存" : "动作已保存，模板名称未同步"),
      icon: librarySaved && templatesSaved ? "success" : "none",
    });
  },

  buildTemplateExercisesFromToday(sets = this.data.sets) {
    const latestByExercise = {};
    const exerciseOrder = [];
    sets.forEach((set) => {
      const exercise = this.data.exerciseLibrary.find((item) => (
        item.id === set.exerciseId || item.name === set.exerciseName
      ));
      const key = this.getExerciseStorageKey(exercise?.id || set.exerciseId, set.exerciseName);
      if (!latestByExercise[key]) {
        const measureType = this.getSetMeasureType(set);
        const metricValue = this.getSetMetricValue(set);
        latestByExercise[key] = {
          exerciseId: exercise?.id || set.exerciseId || "",
          exerciseName: exercise?.name || set.exerciseName,
          measureType,
          weight: Number(set.weight) || 0,
          reps: metricValue,
          ...(measureType === "duration" ? { durationSeconds: metricValue } : {}),
          restSeconds: Math.max(15, Number(set.restSeconds) || 90),
        };
      }
    });
    [...sets].reverse().forEach((set) => {
      const exercise = this.data.exerciseLibrary.find((item) => (
        item.id === set.exerciseId || item.name === set.exerciseName
      ));
      const key = this.getExerciseStorageKey(exercise?.id || set.exerciseId, set.exerciseName);
      if (!exerciseOrder.includes(key)) exerciseOrder.push(key);
    });
    return exerciseOrder.map((key) => latestByExercise[key]).filter(Boolean);
  },

  openTemplateManager() {
    if (this.guardFarmerTimingProgress()) return;
    this.setData({ showTemplateManager: true });
  },

  closeTemplateManager() {
    this.setData({ showTemplateManager: false });
  },

  saveTodayAsTemplate() {
    const exercises = this.buildTemplateExercisesFromToday(this.refreshWorkoutDay());
    if (!exercises.length) {
      wx.showToast({ title: "先完成至少一组训练", icon: "none" });
      return;
    }
    const date = new Date();
    const defaultName = `${date.getMonth() + 1}月${date.getDate()}日训练`;
    wx.showModal({
      title: "保存训练模板",
      content: "下次可一键带入动作、重量、次数或时长，以及休息时间",
      editable: true,
      placeholderText: defaultName,
      confirmText: "保存",
      success: (result) => {
        if (!result.confirm) return;
        const name = String(result.content || defaultName).trim().slice(0, 20);
        if (!name) return;
        const existing = this.data.templates.find((template) => template.name === name);
        const template = {
          id: existing?.id || createId("template"),
          name,
          exercises,
          updatedAt: Date.now(),
        };
        const templates = existing
          ? this.data.templates.map((item) => item.id === existing.id ? template : item)
          : [template, ...this.data.templates];
        try {
          wx.setStorageSync(WORKOUT_TEMPLATES_KEY, templates);
        } catch (error) {
          wx.showToast({ title: "存储空间不足，模板未保存", icon: "none" });
          return;
        }
        this.setData({ templates });
        wx.showToast({ title: existing ? "模板已更新" : "模板已保存", icon: "success" });
      },
    });
  },

  startTemplate(event) {
    if (this.data.mode !== "training") return;
    if (this.guardFarmerTimingProgress()) return;
    const template = this.data.templates.find((item) => item.id === event.currentTarget.dataset.id);
    if (!template?.exercises.length) return;
    this.setData({
      showTemplateManager: false,
      activeTemplateId: template.id,
      activeTemplateName: template.name,
      activeTemplateExercises: template.exercises,
      activeTemplateIndex: -1,
    }, () => this.applyTemplateExercise(0));
  },

  applyTemplateExercise(index) {
    const templateExercise = this.data.activeTemplateExercises[index];
    if (!templateExercise) return;
    const exercise = this.ensureExerciseInLibrary(
      templateExercise.exerciseName,
      templateExercise.exerciseId,
    );
    if (exercise.id !== this.data.exerciseId && this.guardFarmerTimingProgress()) return;
    if (exercise.id !== this.data.exerciseId) this.resetFarmerTiming();
    const measureType = normalizeMeasureType(exercise.measureType);
    const templateMeasureType = normalizeMeasureType(templateExercise.measureType);
    const metricValue = templateMeasureType === measureType
      ? Number(templateMeasureType === "duration"
        ? (templateExercise.durationSeconds ?? templateExercise.reps)
        : templateExercise.reps) || defaultMetricValue(measureType)
      : defaultMetricValue(measureType);
    const restSeconds = Math.max(15, Number(templateExercise.restSeconds) || 90);
    this.setData({
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      measureType,
      weight: String(Number(templateExercise.weight) || 0),
      reps: String(metricValue),
      restSeconds: String(restSeconds),
      timerRemaining: restSeconds,
      timerText: formatClock(restSeconds),
      timerProgress: 100,
      activeTemplateIndex: index,
      lastPerformance: this.findLastPerformance(exercise.id, exercise.name),
    }, () => this.saveConfig());
  },

  selectTemplateExercise(event) {
    this.applyTemplateExercise(Number(event.currentTarget.dataset.index));
  },

  clearActiveTemplate() {
    this.setData({
      activeTemplateId: "",
      activeTemplateName: "",
      activeTemplateExercises: [],
      activeTemplateIndex: -1,
    });
  },

  deleteTemplate(event) {
    const id = event.currentTarget.dataset.id;
    const template = this.data.templates.find((item) => item.id === id);
    if (!template) return;
    wx.showModal({
      title: `删除“${template.name}”？`,
      content: "只删除模板，不会删除已经保存的训练记录。",
      confirmText: "删除",
      confirmColor: "#e54545",
      success: (result) => {
        if (!result.confirm) return;
        const templates = this.data.templates.filter((item) => item.id !== id);
        wx.setStorageSync(WORKOUT_TEMPLATES_KEY, templates);
        const update = { templates };
        if (this.data.activeTemplateId === id) {
          Object.assign(update, {
            activeTemplateId: "",
            activeTemplateName: "",
            activeTemplateExercises: [],
            activeTemplateIndex: -1,
          });
        }
        this.setData(update);
      },
    });
  },

  startStepper(event) {
    const key = event.currentTarget.dataset.key;
    if (key === "weight" && this.isFarmerWeightLocked()) {
      wx.showToast({ title: "计时开始后重量已锁定", icon: "none" });
      return;
    }
    const step = Number(event.currentTarget.dataset.step);
    this.stopStepper();
    this.suppressStepperTap = true;
    this.stepperKey = key;
    this.stepperStep = step;
    this.stepperConfigDirty = true;
    this.adjustMetricValue(key, step, false);
    this.stepperInterval = setInterval(() => this.adjustMetricValue(key, step, false), 120);
  },

  stopStepper() {
    if (this.stepperInterval) clearInterval(this.stepperInterval);
    this.stepperInterval = null;
    if (this.suppressStepperTap) {
      clearTimeout(this.stepperTapReset);
      this.stepperTapReset = setTimeout(() => {
        this.suppressStepperTap = false;
      }, 400);
    }
    if (this.stepperConfigDirty) {
      this.stepperConfigDirty = false;
      this.saveConfig();
    }
    this.stepperKey = null;
    this.stepperStep = null;
  },

  stepMetric(event) {
    if (this.suppressStepperTap) {
      this.suppressStepperTap = false;
      clearTimeout(this.stepperTapReset);
      return;
    }
    const key = event.currentTarget.dataset.key;
    const step = Number(event.currentTarget.dataset.step);
    this.adjustMetricValue(key, step);
  },

  adjustMetricValue(key, step, persist = true) {
    if (key === "weight" && this.isFarmerWeightLocked()) {
      wx.showToast({ title: "计时开始后重量已锁定", icon: "none" });
      return;
    }
    const current = Number(this.data[key]) || 0;
    let next = Math.max(0, current + step);
    if (key === "weight") next = Math.round(next * 10) / 10;
    if (key === "reps") next = Math.round(next);
    this.setData({ [key]: String(next) }, () => {
      if (persist) this.saveConfig();
    });
  },

  completeSet() {
    if (this.data.mode !== "training" || this.isCompletingSet) return;

    const exerciseName = String(this.data.exerciseName).trim();
    const weight = Number(this.data.weight);
    const reps = Number(this.data.reps);
    const restSeconds = Math.max(15, Number(this.data.restSeconds) || 90);
    const configuredExercise = this.data.exerciseLibrary.find((item) => (
      item.id === this.data.exerciseId || item.name === exerciseName
    ));
    const isFarmerWalk = (configuredExercise?.id || this.data.exerciseId) === "farmer_walk";
    const measureType = isFarmerWalk ? "duration" : normalizeMeasureType(configuredExercise?.measureType);
    if (!exerciseName || weight < 0 || (!isFarmerWalk && reps <= 0)) {
      wx.showToast({
        title: `请完善动作、重量和${measureType === "duration" ? "时长" : "次数"}`,
        icon: "none",
      });
      return;
    }
    if (isFarmerWalk && this.data.farmerActiveSide) {
      wx.showToast({ title: "请先结束当前一侧", icon: "none" });
      return;
    }

    const leftDurationMs = Number(this.data.farmerLeftDurationMs) || 0;
    const rightDurationMs = Number(this.data.farmerRightDurationMs) || 0;
    if (isFarmerWalk && (!leftDurationMs || !rightDurationMs)) {
      wx.showToast({ title: "请完成左右手计时", icon: "none" });
      return;
    }
    const leftDurationSeconds = Math.round(leftDurationMs / 100) / 10;
    const rightDurationSeconds = Math.round(rightDurationMs / 100) / 10;
    const metricValue = isFarmerWalk
      ? Math.round((leftDurationSeconds + rightDurationSeconds) * 10) / 10
      : reps;
    this.isCompletingSet = true;

    const currentDateKey = todayKey();
    const existingSets = this.workoutDateKey === currentDateKey
      ? this.data.sets
      : this.normalizeWorkoutSets(
        wx.getStorageSync(`workout_${currentDateKey}`) || [],
      );
    const exercise = this.ensureExerciseInLibrary(exerciseName);
    const now = new Date();
    const set = {
      id: now.getTime(),
      exerciseId: exercise.id,
      exerciseName,
      measureType,
      weight,
      reps: metricValue,
      ...(measureType === "duration" ? { durationSeconds: metricValue } : {}),
      ...(isFarmerWalk ? {
        trackingMode: "farmer_sides",
        leftDurationSeconds,
        rightDurationSeconds,
        leftStartedAt: Number(this.farmerSideStartedAt?.left) || null,
        leftEndedAt: Number(this.farmerSideEndedAt?.left) || null,
        rightStartedAt: Number(this.farmerSideStartedAt?.right) || null,
        rightEndedAt: Number(this.farmerSideEndedAt?.right) || null,
      } : {}),
      restSeconds,
      time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      heartAtFinish: Number(this.data.heartRate) || null,
      dateKey: currentDateKey,
    };
    const sets = [set, ...existingSets];
    try {
      wx.setStorageSync(`workout_${currentDateKey}`, sets);
    } catch (error) {
      this.isCompletingSet = false;
      wx.showModal({
        title: "本地存储空间不足",
        content: "本组暂未保存。请清理部分小程序缓存后再试，已有训练记录不会被修改。",
        showCancel: false,
      });
      return;
    }
    this.workoutDateKey = currentDateKey;
    this.activeSetDateKey = currentDateKey;
    this.activeSetId = set.id;
    this.saveConfig({ exerciseId: exercise.id, exerciseName, measureType, reps: metricValue, restSeconds });
    this.updateLastPerformance(set, sets);

    this.restStartedAt = Date.now();
    this.restHeartPoints = [];
    this.restPeakValue = Number(this.data.heartRate) || 0;
    this.heartAt60Value = null;
    this.setData({
      mode: "rest",
      exerciseId: exercise.id,
      measureType,
      sets,
      totalVolume: this.calculateVolume(sets),
      dateLabel: `${now.getMonth() + 1}月${now.getDate()}日`,
      restPeak: this.restPeakValue || "--",
      heartRecovery: this.restPeakValue ? 0 : "--",
      heartAt60: "--",
      recoveryStatus: this.restPeakValue ? "正在寻找本组峰值" : "连接心率设备后可分析恢复",
    }, () => {
      this.drawHeartSparkline();
      setTimeout(() => { this.isCompletingSet = false; }, 300);
    });
    this.startRest(restSeconds);
    wx.vibrateShort({ type: "medium" });
    wx.showToast({ title: `第${sets.length}组已记录`, icon: "success" });
  },

  startRest(seconds, totalSeconds = seconds) {
    this.clearTimer();
    const remaining = Math.max(1, Math.round(seconds));
    this.restTotalSeconds = Math.max(remaining, Math.round(totalSeconds));
    this.restEndAt = Date.now() + remaining * 1000;
    this.timerFinishedNotified = false;
    this.setData({
      timerRemaining: remaining,
      timerText: formatClock(remaining),
      timerRunning: true,
      timerProgress: Math.round((remaining / this.restTotalSeconds) * 100),
    });
    this.startCountdownTicker();
  },

  startCountdownTicker() {
    this.clearTimer();
    this.syncRestCountdown();
    if (!this.data.timerRunning || !this.restEndAt) return;
    this.timer = setInterval(() => this.syncRestCountdown(), 250);
  },

  syncRestCountdown() {
    if (!this.data.timerRunning || !this.restEndAt) return;
    const remaining = Math.max(0, Math.ceil((this.restEndAt - Date.now()) / 1000));
    const timerProgress = this.restTotalSeconds
      ? Math.max(0, Math.min(100, Math.round((remaining / this.restTotalSeconds) * 100)))
      : 0;
    if (remaining > 0) {
      if (remaining !== this.data.timerRemaining) {
        this.setData({ timerRemaining: remaining, timerText: formatClock(remaining), timerProgress });
      }
      return;
    }

    this.clearTimer();
    this.restEndAt = null;
    this.setData({
      timerRemaining: 0,
      timerText: "00:00",
      timerRunning: false,
      timerProgress: 0,
      recoveryStatus: Number(this.data.heartRecovery) >= RECOVERY_READY_BPM
        ? "恢复良好，可以开始下一组"
        : "休息时间已到，请结合体感决定",
    });
    if (!this.timerFinishedNotified) {
      this.timerFinishedNotified = true;
      wx.vibrateLong();
      wx.showToast({ title: "休息结束，开始下一组", icon: "none", duration: 2500 });
    }
  },

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  toggleTimer() {
    if (this.data.timerRunning) {
      this.syncRestCountdown();
      this.clearTimer();
      this.restEndAt = null;
      this.setData({ timerRunning: false });
      return;
    }
    const seconds = this.data.timerRemaining > 0
      ? this.data.timerRemaining
      : Number(this.data.restSeconds) || 90;
    this.startRest(seconds, Math.max(this.restTotalSeconds || 0, seconds));
  },

  adjustTimer(event) {
    const delta = Number(event.currentTarget.dataset.delta);
    const next = Math.max(0, this.data.timerRemaining + delta);
    if (delta > 0) this.restTotalSeconds = Math.max(next, (this.restTotalSeconds || 0) + delta);
    const timerProgress = this.restTotalSeconds
      ? Math.max(0, Math.min(100, Math.round((next / this.restTotalSeconds) * 100)))
      : 0;
    if (this.data.timerRunning) {
      this.restEndAt = Date.now() + next * 1000;
    }
    this.setData({ timerRemaining: next, timerText: formatClock(next), timerProgress });
    if (next === 0 && this.data.timerRunning) this.syncRestCountdown();
  },

  resetTimer() {
    this.clearTimer();
    this.restEndAt = null;
    const seconds = Math.max(15, Number(this.data.restSeconds) || 90);
    this.restTotalSeconds = seconds;
    this.setData({ timerRemaining: seconds, timerText: formatClock(seconds), timerRunning: false, timerProgress: 100 });
  },

  getRecoveryUpdate(heartRate) {
    if (!this.restStartedAt) return {};
    const elapsedSeconds = Math.floor((Date.now() - this.restStartedAt) / 1000);
    if (elapsedSeconds <= 30) {
      this.restPeakValue = Math.max(this.restPeakValue || 0, Number(heartRate));
    }
    const peak = this.restPeakValue || Number(heartRate);
    const recovery = Math.max(0, peak - Number(heartRate));
    if (elapsedSeconds >= 60 && this.heartAt60Value == null) {
      this.heartAt60Value = recovery;
    }
    return {
      restPeak: peak,
      heartRecovery: recovery,
      heartAt60: this.heartAt60Value == null ? "--" : this.heartAt60Value,
      recoveryStatus: recovery >= RECOVERY_READY_BPM
        ? "恢复良好，可以开始下一组"
        : "继续恢复，保持呼吸平稳",
    };
  },

  drawHeartSparkline() {
    const cutoff = Date.now() - 90000;
    const points = (this.restHeartPoints || []).filter((point) => point[0] >= cutoff);
    this.restHeartPoints = points;
    const query = wx.createSelectorQuery().in(this);
    query.select("#heartSparkline").boundingClientRect((rect) => {
      if (!rect) return;
      const ctx = wx.createCanvasContext("heartSparkline", this);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.setStrokeStyle("rgba(116, 132, 154, 0.18)");
      ctx.setLineWidth(1);
      for (let index = 1; index < 4; index += 1) {
        const y = (rect.height / 4) * index;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(rect.width, y);
        ctx.stroke();
      }
      if (points.length > 1) {
        const rates = points.map((point) => point[1]);
        const minimum = Math.min(...rates) - 5;
        const maximum = Math.max(...rates) + 5;
        const range = Math.max(10, maximum - minimum);
        const firstTime = points[0][0];
        const timeRange = Math.max(1000, points[points.length - 1][0] - firstTime);
        ctx.beginPath();
        points.forEach((point, index) => {
          const x = ((point[0] - firstTime) / timeRange) * rect.width;
          const y = rect.height - ((point[1] - minimum) / range) * rect.height;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.setStrokeStyle("#ff5965");
        ctx.setLineWidth(3);
        ctx.setLineCap("round");
        ctx.setLineJoin("round");
        ctx.stroke();
      }
      ctx.draw();
    }).exec();
  },

  saveRestSummary() {
    const storageDateKey = this.activeSetDateKey || this.workoutDateKey || todayKey();
    const sets = wx.getStorageSync(`workout_${storageDateKey}`) || [];
    const setIndex = sets.findIndex((item) => item.id === this.activeSetId);
    if (setIndex < 0) return;
    sets[setIndex] = {
      ...sets[setIndex],
      heartPeak: this.restPeakValue || Number(this.data.restPeak) || null,
      heartRecovery60: this.heartAt60Value ?? (Number(this.data.heartAt60) || null),
      restActualSeconds: this.restStartedAt
        ? Math.max(0, Math.round((Date.now() - this.restStartedAt) / 1000))
        : 0,
    };
    try {
      wx.setStorageSync(`workout_${storageDateKey}`, sets);
    } catch (error) {
      wx.showToast({ title: "恢复摘要未保存，训练组仍已保留", icon: "none" });
    }
    this.setData({ sets: this.normalizeWorkoutSets(sets) });
  },

  startNextSet() {
    this.saveRestSummary();
    this.clearTimer();
    this.restEndAt = null;
    this.restStartedAt = null;
    this.restPeakValue = 0;
    this.heartAt60Value = null;
    this.restHeartPoints = [];
    this.resetFarmerTiming();
    const seconds = Math.max(15, Number(this.data.restSeconds) || 90);
    const currentDateKey = todayKey();
    const dayChanged = currentDateKey !== this.workoutDateKey;
    const sets = dayChanged
      ? this.normalizeWorkoutSets(
        wx.getStorageSync(`workout_${currentDateKey}`) || [],
      )
      : this.data.sets;
    const now = new Date();
    this.workoutDateKey = currentDateKey;
    this.activeSetDateKey = null;
    this.activeSetId = null;
    this.restTotalSeconds = seconds;
    this.setData({
      mode: "training",
      dateLabel: `${now.getMonth() + 1}月${now.getDate()}日`,
      sets,
      totalVolume: this.calculateVolume(sets),
      timerRemaining: seconds,
      timerText: formatClock(seconds),
      timerRunning: false,
      timerProgress: 100,
      restPeak: "--",
      heartRecovery: "--",
      heartAt60: "--",
      recoveryStatus: "完成一组后开始分析恢复",
    });
  },

  removeSet(event) {
    const id = Number(event.currentTarget.dataset.id);
    wx.showModal({
      title: "删除这组记录？",
      content: "删除后将重新计算今天的训练容量。",
      success: (result) => {
        if (!result.confirm) return;
        const removedSet = this.data.sets.find((item) => item.id === id);
        if (!removedSet) return;
        const sets = this.data.sets.filter((item) => item.id !== id);
        wx.setStorageSync(`workout_${this.workoutDateKey || todayKey()}`, sets);
        this.refreshLastPerformanceForExercise(removedSet.exerciseId, removedSet.exerciseName);
        this.setData({
          sets,
          totalVolume: this.calculateVolume(sets),
          lastPerformance: this.findLastPerformance(this.data.exerciseId, this.data.exerciseName),
        });
      },
    });
  },

  registerDeviceFoundListener() {
    if (this.deviceFoundHandler && wx.offBluetoothDeviceFound) {
      wx.offBluetoothDeviceFound(this.deviceFoundHandler);
    }
    this.deviceFoundHandler = (result) => {
      const found = result.devices.filter((device) => device.name || device.localName);
      const merged = [...this.data.bluetoothDevices];
      found.forEach((device) => {
        const index = merged.findIndex((item) => item.deviceId === device.deviceId);
        const next = { ...device, displayName: device.name || device.localName || "未命名设备" };
        if (index >= 0) merged[index] = next;
        else merged.push(next);
      });
      this.setData({ bluetoothDevices: merged });
    };
    wx.onBluetoothDeviceFound(this.deviceFoundHandler);
  },

  stopDeviceDiscovery() {
    wx.stopBluetoothDevicesDiscovery({ fail: () => {} });
    if (this.deviceFoundHandler && wx.offBluetoothDeviceFound) {
      wx.offBluetoothDeviceFound(this.deviceFoundHandler);
      this.deviceFoundHandler = null;
    }
  },

  scanHeartRate() {
    if (this.data.connectedDeviceId) {
      wx.showModal({
        title: "断开心率设备？",
        content: "断开后将停止接收实时心率，已经保存的数据不会丢失。",
        confirmText: "断开",
        confirmColor: "#e54545",
        success: (result) => {
          if (result.confirm) this.disconnectHeartRate();
        },
      });
      return;
    }
    this.startHeartRateScan();
  },

  async startHeartRateScan() {
    this.setData({ showDevices: true, scanning: true, bluetoothDevices: [], heartStatus: "正在搜索设备…" });
    try {
      await wx.openBluetoothAdapter();
      this.registerDeviceFoundListener();
      await wx.startBluetoothDevicesDiscovery({
        services: ["180D"],
        allowDuplicatesKey: false,
        interval: 0,
      });
    } catch (error) {
      this.stopDeviceDiscovery();
      this.setData({ scanning: false, heartStatus: "蓝牙不可用" });
      wx.showModal({
        title: "无法使用蓝牙",
        content: "请在手机系统设置中允许微信使用蓝牙，并使用真机预览。电脑模拟器不能连接心率带。",
        showCancel: false,
      });
    }
  },

  disconnectHeartRate() {
    const deviceId = this.data.connectedDeviceId;
    this.saveHeartSamples();
    this.stopDeviceDiscovery();
    this.clearPendingHeartDisplay();
    this.heartRateCharacteristicId = "";
    this.setData({
      connectedDeviceId: "",
      heartRate: "--",
      heartStatus: "连接心率设备",
    });
    if (deviceId) {
      wx.closeBLEConnection({ deviceId, fail: () => {} });
    }
  },

  closeDeviceList() {
    this.stopDeviceDiscovery();
    this.setData({ showDevices: false, scanning: false, heartStatus: "连接心率设备" });
  },

  async connectDevice(event) {
    const deviceId = event.currentTarget.dataset.id;
    const name = event.currentTarget.dataset.name;
    wx.showLoading({ title: "正在连接" });
    try {
      this.stopDeviceDiscovery();
      await wx.createBLEConnection({ deviceId, timeout: 10000 });
      const serviceResult = await wx.getBLEDeviceServices({ deviceId });
      const service = serviceResult.services.find(
        (item) => normalizeBleUuid(item.uuid) === HEART_RATE_SERVICE,
      );
      if (!service) throw new Error("not-heart-rate-device");
      const characteristicResult = await wx.getBLEDeviceCharacteristics({ deviceId, serviceId: service.uuid });
      const characteristic = characteristicResult.characteristics.find(
        (item) => normalizeBleUuid(item.uuid) === HEART_RATE_MEASUREMENT
          && (item.properties.notify || item.properties.indicate),
      );
      if (!characteristic) throw new Error("no-heart-rate-characteristic");
      this.heartRateCharacteristicId = characteristic.uuid;
      await wx.notifyBLECharacteristicValueChange({
        state: true,
        deviceId,
        serviceId: service.uuid,
        characteristicId: characteristic.uuid,
      });
      this.setData({
        connectedDeviceId: deviceId,
        showDevices: false,
        scanning: false,
        heartStatus: `${name} 已连接`,
      });
      wx.showToast({ title: "心率设备已连接", icon: "success" });
    } catch (error) {
      this.heartRateCharacteristicId = "";
      wx.closeBLEConnection({ deviceId, fail: () => {} });
      this.setData({ heartStatus: "连接失败，请重试" });
      wx.showModal({
        title: "连接失败",
        content: "请确认这是支持标准蓝牙心率服务的设备，并让心率带保持佩戴和唤醒状态。",
        showCancel: false,
      });
    } finally {
      wx.hideLoading();
    }
  },
});
