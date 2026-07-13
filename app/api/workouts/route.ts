import { env } from "cloudflare:workers";

type Statement = {
  bind(...values: unknown[]): Statement;
  all<T>(): Promise<{ results: T[] }>;
};

type Database = {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
};

type RecordInput = {
  id: string;
  workoutDate: string;
  completedAt: number;
  exercise: string;
  weightKg: number;
  reps: number;
  heartRateBpm: number | null;
};

type SetRow = {
  id: string;
  workout_date: string;
  completed_at: number;
  exercise: string;
  weight_kg: number;
  reps: number;
  heart_rate_bpm: number | null;
};

type PresetRow = {
  id: string;
  name: string;
  default_weight_kg: number;
  default_reps: number;
};

function getDatabase() {
  return (env as unknown as { DB: Database }).DB;
}

async function initializeSchema(db: Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS workout_sets (
      id TEXT PRIMARY KEY NOT NULL,
      device_id TEXT NOT NULL,
      workout_date TEXT NOT NULL,
      completed_at INTEGER NOT NULL,
      exercise TEXT NOT NULL,
      weight_kg REAL NOT NULL,
      reps INTEGER NOT NULL,
      heart_rate_bpm INTEGER
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS workout_sets_device_date_idx ON workout_sets (device_id, workout_date)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS exercise_presets (
      id TEXT PRIMARY KEY NOT NULL,
      device_id TEXT NOT NULL,
      name TEXT NOT NULL,
      default_weight_kg REAL NOT NULL,
      default_reps INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS exercise_presets_device_name_idx ON exercise_presets (device_id, name)"),
  ]);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId")?.trim() ?? "";
  const date = url.searchParams.get("date") ?? "";
  if (!deviceId || !validDate(date)) {
    return Response.json({ error: "Invalid device or date" }, { status: 400 });
  }

  const db = getDatabase();
  await initializeSchema(db);
  const [setResult, presetResult] = await Promise.all([
    db
      .prepare(`SELECT id, workout_date, completed_at, exercise, weight_kg, reps, heart_rate_bpm
        FROM workout_sets WHERE device_id = ? AND workout_date = ? ORDER BY completed_at ASC`)
      .bind(deviceId, date)
      .all<SetRow>(),
    db
      .prepare(`SELECT id, name, default_weight_kg, default_reps
        FROM exercise_presets WHERE device_id = ? ORDER BY updated_at DESC`)
      .bind(deviceId)
      .all<PresetRow>(),
  ]);

  return Response.json({
    records: setResult.results.map((row) => ({
      id: row.id,
      workoutDate: row.workout_date,
      completedAt: row.completed_at,
      exercise: row.exercise,
      weightKg: row.weight_kg,
      reps: row.reps,
      heartRateBpm: row.heart_rate_bpm,
    })),
    presets: presetResult.results.map((row) => ({
      id: row.id,
      name: row.name,
      defaultWeightKg: row.default_weight_kg,
      defaultReps: row.default_reps,
    })),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { deviceId?: string; record?: RecordInput };
  const deviceId = body.deviceId?.trim() ?? "";
  const record = body.record;
  const exercise = record?.exercise.trim() ?? "";
  if (
    !deviceId ||
    !record ||
    !record.id ||
    !validDate(record.workoutDate) ||
    !exercise ||
    !Number.isFinite(record.weightKg) ||
    record.weightKg < 0 ||
    !Number.isInteger(record.reps) ||
    record.reps < 1
  ) {
    return Response.json({ error: "Invalid workout set" }, { status: 400 });
  }

  const db = getDatabase();
  await initializeSchema(db);
  const presetId = `${deviceId}:${exercise}`;
  await db.batch([
    db
      .prepare(`INSERT INTO workout_sets
        (id, device_id, workout_date, completed_at, exercise, weight_kg, reps, heart_rate_bpm)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          workout_date = excluded.workout_date,
          completed_at = excluded.completed_at,
          exercise = excluded.exercise,
          weight_kg = excluded.weight_kg,
          reps = excluded.reps,
          heart_rate_bpm = excluded.heart_rate_bpm`)
      .bind(
        record.id,
        deviceId,
        record.workoutDate,
        record.completedAt,
        exercise,
        record.weightKg,
        record.reps,
        record.heartRateBpm,
      ),
    db
      .prepare(`INSERT INTO exercise_presets
        (id, device_id, name, default_weight_kg, default_reps, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id, name) DO UPDATE SET
          default_weight_kg = excluded.default_weight_kg,
          default_reps = excluded.default_reps,
          updated_at = excluded.updated_at`)
      .bind(presetId, deviceId, exercise, record.weightKg, record.reps, Date.now()),
  ]);

  return Response.json({
    preset: {
      id: presetId,
      name: exercise,
      defaultWeightKg: record.weightKg,
      defaultReps: record.reps,
    },
  });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId")?.trim() ?? "";
  const id = url.searchParams.get("id")?.trim() ?? "";
  if (!deviceId || !id) {
    return Response.json({ error: "Invalid record" }, { status: 400 });
  }

  const db = getDatabase();
  await initializeSchema(db);
  await db.batch([
    db.prepare("DELETE FROM workout_sets WHERE id = ? AND device_id = ?").bind(id, deviceId),
  ]);
  return Response.json({ ok: true });
}
