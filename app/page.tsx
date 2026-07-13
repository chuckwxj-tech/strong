"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TimerState = "idle" | "running" | "paused" | "done";

type WorkoutSet = {
  id: string;
  workoutDate: string;
  completedAt: number;
  exercise: string;
  weightKg: number;
  reps: number;
  heartRateBpm: number | null;
};

type ExercisePreset = {
  id: string;
  name: string;
  defaultWeightKg: number;
  defaultReps: number;
};

type HeartRateCharacteristic = EventTarget & {
  value?: DataView;
  startNotifications(): Promise<HeartRateCharacteristic>;
};

type HeartRateService = {
  getCharacteristic(name: string): Promise<HeartRateCharacteristic>;
};

type HeartRateServer = {
  getPrimaryService(name: string): Promise<HeartRateService>;
};

type HeartRateDevice = EventTarget & {
  name?: string;
  gatt?: { connect(): Promise<HeartRateServer> };
};

type BluetoothApi = {
  requestDevice(options: {
    filters: Array<{ services: string[] }>;
  }): Promise<HeartRateDevice>;
};

const DEFAULT_EXERCISES = ["深蹲", "卧推", "硬拉", "划船", "肩推"];

function getLocalDateKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function parseHeartRate(value?: DataView) {
  if (!value || value.byteLength < 2) return null;
  return value.getUint8(0) & 1 ? value.getUint16(1, true) : value.getUint8(1);
}

function playFinishCue() {
  try {
    const AudioContextClass = window.AudioContext;
    const audio = new AudioContextClass();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 720;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.36);
  } catch {
    // Vibration remains the fallback on devices that block background audio.
  }
}

export default function Home() {
  const [dateKey, setDateKey] = useState(getLocalDateKey);
  const [deviceId, setDeviceId] = useState("");
  const [records, setRecords] = useState<WorkoutSet[]>([]);
  const [presets, setPresets] = useState<ExercisePreset[]>([]);
  const [exercise, setExercise] = useState("深蹲");
  const [weightKg, setWeightKg] = useState(80);
  const [reps, setReps] = useState(8);
  const [duration, setDuration] = useState(90);
  const [remaining, setRemaining] = useState(90);
  const [timerState, setTimerState] = useState<TimerState>("idle");
  const [saveStatus, setSaveStatus] = useState("准备记录");
  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [heartStatus, setHeartStatus] = useState("连接心率");
  const [heartDeviceName, setHeartDeviceName] = useState("");
  const endAtRef = useRef<number | null>(null);
  const heartDeviceRef = useRef<HeartRateDevice | null>(null);

  const loadDay = useCallback(async (id: string, day: string) => {
    setSaveStatus("正在读取");
    try {
      const response = await fetch(
        `/api/workouts?deviceId=${encodeURIComponent(id)}&date=${encodeURIComponent(day)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("load failed");
      const data = (await response.json()) as {
        records: WorkoutSet[];
        presets: ExercisePreset[];
      };
      setRecords(data.records);
      setPresets(data.presets);
      setSaveStatus("记录已同步");
    } catch {
      setRecords([]);
      setSaveStatus("暂时无法读取记录");
    }
  }, []);

  useEffect(() => {
    const storageKey = "rest-set-device-id";
    let id = window.localStorage.getItem(storageKey);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(storageKey, id);
    }
    setDeviceId(id);
    void loadDay(id, dateKey);
  }, [dateKey, loadDay]);

  useEffect(() => {
    if (timerState !== "running") return;

    const update = () => {
      if (!endAtRef.current) return;
      const next = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0) {
        endAtRef.current = null;
        setTimerState("done");
        if ("vibrate" in navigator) navigator.vibrate([160, 100, 220]);
        playFinishCue();
      }
    };

    update();
    const interval = window.setInterval(update, 250);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
    };
  }, [timerState]);

  const exerciseSuggestions = useMemo(
    () => Array.from(new Set([...DEFAULT_EXERCISES, ...presets.map((item) => item.name)])),
    [presets],
  );

  const totalVolume = useMemo(
    () => records.reduce((sum, item) => sum + item.weightKg * item.reps, 0),
    [records],
  );

  const chooseExercise = (name: string) => {
    setExercise(name);
    const preset = presets.find((item) => item.name === name);
    if (preset) {
      setWeightKg(preset.defaultWeightKg);
      setReps(preset.defaultReps);
    }
  };

  const setTimerDuration = (seconds: number) => {
    const next = Math.max(15, Math.min(599, seconds));
    setDuration(next);
    setRemaining(next);
    if (timerState === "running") endAtRef.current = Date.now() + next * 1000;
    if (timerState === "done") setTimerState("idle");
  };

  const adjustTimer = (delta: number) => {
    const next = Math.max(0, Math.min(599, remaining + delta));
    setRemaining(next);
    setDuration(next || duration);
    if (timerState === "running") endAtRef.current = Date.now() + next * 1000;
  };

  const startTimer = () => {
    const seconds = remaining || duration;
    setRemaining(seconds);
    endAtRef.current = Date.now() + seconds * 1000;
    setTimerState("running");
  };

  const recordSet = async () => {
    const cleanExercise = exercise.trim();
    if (!cleanExercise || weightKg < 0 || reps < 1) {
      setSaveStatus("请先填写有效的动作、重量和次数");
      return;
    }

    const item: WorkoutSet = {
      id: crypto.randomUUID(),
      workoutDate: dateKey,
      completedAt: Date.now(),
      exercise: cleanExercise,
      weightKg,
      reps,
      heartRateBpm: heartRate,
    };

    setRecords((current) => [...current, item]);
    setSaveStatus("正在保存本组");
    startTimer();

    try {
      const response = await fetch("/api/workouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId, record: item }),
      });
      if (!response.ok) throw new Error("save failed");
      const data = (await response.json()) as { preset: ExercisePreset };
      setPresets((current) => {
        const withoutCurrent = current.filter((entry) => entry.name !== data.preset.name);
        return [...withoutCurrent, data.preset];
      });
      setSaveStatus("本组已保存");
    } catch {
      setSaveStatus("本组未同步，请稍后再试");
    }
  };

  const handlePrimary = () => {
    if (timerState === "running") {
      if (endAtRef.current) {
        setRemaining(Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000)));
      }
      endAtRef.current = null;
      setTimerState("paused");
      return;
    }
    if (timerState === "paused") {
      startTimer();
      return;
    }
    void recordSet();
  };

  const deleteRecord = async (id: string) => {
    const previous = records;
    setRecords((current) => current.filter((item) => item.id !== id));
    try {
      const response = await fetch(
        `/api/workouts?deviceId=${encodeURIComponent(deviceId)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("delete failed");
      setSaveStatus("记录已删除");
    } catch {
      setRecords(previous);
      setSaveStatus("删除失败");
    }
  };

  const connectHeartRate = async () => {
    const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth;
    if (!bluetooth) {
      setHeartStatus("此浏览器不支持蓝牙");
      return;
    }

    setHeartStatus("正在选择设备");
    try {
      const device = await bluetooth.requestDevice({
        filters: [{ services: ["heart_rate"] }],
      });
      if (!device.gatt) throw new Error("missing gatt");
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService("heart_rate");
      const characteristic = await service.getCharacteristic("heart_rate_measurement");
      characteristic.addEventListener("characteristicvaluechanged", (event) => {
        const bpm = parseHeartRate((event.target as HeartRateCharacteristic).value);
        if (bpm) setHeartRate(bpm);
      });
      device.addEventListener("gattserverdisconnected", () => {
        setHeartRate(null);
        setHeartStatus("心率已断开");
      });
      await characteristic.startNotifications();
      heartDeviceRef.current = device;
      setHeartDeviceName(device.name ?? "心率设备");
      setHeartStatus("心率已连接");
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      setHeartStatus(name === "NotFoundError" ? "已取消连接" : "连接失败，请确认已广播");
    }
  };

  const primaryLabel =
    timerState === "running"
      ? "暂停休息"
      : timerState === "paused"
        ? "继续休息"
        : timerState === "done"
          ? "完成下一组 · 开始休息"
          : "完成本组 · 开始休息";

  return (
    <main className="app-shell">
      <section className="app-card" aria-label="REST / SET 组间休息计时器">
        <header className="topbar">
          <div>
            <h1 className="brand">REST <span>/</span> SET</h1>
            <p className="eyebrow">力量训练组间控制</p>
          </div>
          <button className={`heart-chip ${heartRate ? "connected" : ""}`} type="button" onClick={connectHeartRate}>
            <span className="heart-mark" aria-hidden="true">♥</span>
            <span>{heartRate ? `${heartRate} BPM` : "连接心率"}</span>
          </button>
        </header>

        <div className="status-row">
          <span>训练进行中 · 已完成 <strong>{records.length}</strong> 组</span>
          <span className="save-status">{saveStatus}</span>
        </div>

        <section className="set-editor" aria-labelledby="set-title">
          <div className="section-heading">
            <div>
              <p className="section-kicker">当前训练组</p>
              <h2 id="set-title">记录动作数据</h2>
            </div>
            <span>完成后自动记住</span>
          </div>

          <label className="exercise-field">
            <span>动作</span>
            <input
              list="exercise-list"
              value={exercise}
              onChange={(event) => chooseExercise(event.target.value)}
              placeholder="输入动作名称"
            />
            <datalist id="exercise-list">
              {exerciseSuggestions.map((item) => <option value={item} key={item} />)}
            </datalist>
          </label>

          <div className="set-metrics">
            <div className="metric-control">
              <span className="metric-label">重量 <small>KG</small></span>
              <div className="stepper">
                <button type="button" aria-label="重量减少 2.5 公斤" onClick={() => setWeightKg((value) => Math.max(0, value - 2.5))}>−</button>
                <input
                  aria-label="重量（公斤）"
                  type="number"
                  min="0"
                  step="0.5"
                  inputMode="decimal"
                  value={weightKg}
                  onChange={(event) => setWeightKg(Math.max(0, Number(event.target.value)))}
                />
                <button type="button" aria-label="重量增加 2.5 公斤" onClick={() => setWeightKg((value) => value + 2.5)}>+</button>
              </div>
            </div>
            <div className="metric-control">
              <span className="metric-label">次数 <small>REPS</small></span>
              <div className="stepper">
                <button type="button" aria-label="次数减少一次" onClick={() => setReps((value) => Math.max(1, value - 1))}>−</button>
                <input
                  aria-label="每组次数"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={reps}
                  onChange={(event) => setReps(Math.max(1, Number(event.target.value)))}
                />
                <button type="button" aria-label="次数增加一次" onClick={() => setReps((value) => value + 1)}>+</button>
              </div>
            </div>
          </div>
        </section>

        <section className={`timer-zone ${timerState}`} aria-live="polite">
          <div className="timer-topline">
            <span>{timerState === "done" ? "休息完成" : "休息时间"}</span>
            <span className="live-heart">
              <i aria-hidden="true" />
              {heartRate ? `${heartRate} BPM` : heartDeviceName || heartStatus}
            </span>
          </div>
          <p className="timer">{formatTime(remaining)}</p>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${duration ? Math.min(100, (remaining / duration) * 100) : 0}%` }} />
          </div>
        </section>

        <p className="control-label">快速设置</p>
        <div className="presets" aria-label="快速设置休息时间">
          {[60, 90, 120].map((seconds) => (
            <button
              className={duration === seconds ? "active" : ""}
              type="button"
              key={seconds}
              onClick={() => setTimerDuration(seconds)}
            >
              {seconds}秒
            </button>
          ))}
        </div>

        <div className="adjust-row">
          <button type="button" onClick={() => adjustTimer(-15)}>− 15秒</button>
          <button type="button" onClick={() => adjustTimer(15)}>+ 15秒</button>
        </div>

        <button className={`primary-action ${timerState}`} type="button" onClick={handlePrimary}>
          {primaryLabel}
        </button>

        <section className="stats" aria-label="当日训练统计">
          <div>
            <span>当日组数</span>
            <strong>{records.length}<small> 组</small></strong>
          </div>
          <div>
            <span>训练容量</span>
            <strong>{Math.round(totalVolume).toLocaleString("zh-CN")}<small> KG</small></strong>
          </div>
        </section>

        <section className="history" aria-labelledby="history-title">
          <div className="history-header">
            <div>
              <p className="section-kicker">每日保存</p>
              <h2 id="history-title">训练记录</h2>
            </div>
            <label>
              <span className="sr-only">记录日期</span>
              <input type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} />
            </label>
          </div>

          {records.length === 0 ? (
            <div className="empty-history">完成第一组后，动作、重量、次数和心率会出现在这里。</div>
          ) : (
            <ol className="record-list">
              {records.map((item, index) => (
                <li key={item.id}>
                  <span className="set-index">{String(index + 1).padStart(2, "0")}</span>
                  <div className="record-main">
                    <strong>{item.exercise}</strong>
                    <span>{item.weightKg}kg × {item.reps}次</span>
                  </div>
                  <div className="record-meta">
                    <span>{item.heartRateBpm ? `♥ ${item.heartRateBpm}` : "无心率"}</span>
                    <time>{new Date(item.completedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
                  </div>
                  <button type="button" aria-label={`删除第 ${index + 1} 组记录`} onClick={() => void deleteRecord(item.id)}>×</button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <p className="heart-help">佳明手表请先开启“广播心率”；心率带请保持唤醒并靠近设备。</p>
      </section>
    </main>
  );
}
