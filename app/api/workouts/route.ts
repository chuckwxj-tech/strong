import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { exercisePresets, workoutSets } from "../../../db/schema";

type RecordInput = {
  id: string;
  workoutDate: string;
  completedAt: number;
  exercise: string;
  weightKg: number;
  reps: number;
  heartRateBpm: number | null;
};

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseRecord(value: unknown): RecordInput | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Partial<RecordInput>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const exercise = typeof record?.exercise === "string" ? record.exercise.trim() : "";
  if (
    !id ||
    typeof record.workoutDate !== "string" ||
    !validDate(record.workoutDate) ||
    typeof record.completedAt !== "number" ||
    !Number.isSafeInteger(record.completedAt) ||
    record.completedAt <= 0 ||
    !exercise ||
    typeof record.weightKg !== "number" ||
    !Number.isFinite(record.weightKg) ||
    record.weightKg < 0 ||
    typeof record.reps !== "number" ||
    !Number.isInteger(record.reps) ||
    record.reps < 1 ||
    !(
      record.heartRateBpm === null ||
      (typeof record.heartRateBpm === "number" &&
        Number.isInteger(record.heartRateBpm) &&
        record.heartRateBpm > 0)
    )
  ) {
    return null;
  }

  return {
    id,
    workoutDate: record.workoutDate,
    completedAt: record.completedAt,
    exercise,
    weightKg: record.weightKg,
    reps: record.reps,
    heartRateBpm: record.heartRateBpm,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId")?.trim() ?? "";
  const date = url.searchParams.get("date") ?? "";
  if (!deviceId || !validDate(date)) {
    return Response.json({ error: "Invalid device or date" }, { status: 400 });
  }

  const db = getDb();
  const [records, presets] = await Promise.all([
    db
      .select({
        id: workoutSets.id,
        workoutDate: workoutSets.workoutDate,
        completedAt: workoutSets.completedAt,
        exercise: workoutSets.exercise,
        weightKg: workoutSets.weightKg,
        reps: workoutSets.reps,
        heartRateBpm: workoutSets.heartRateBpm,
      })
      .from(workoutSets)
      .where(and(eq(workoutSets.deviceId, deviceId), eq(workoutSets.workoutDate, date)))
      .orderBy(asc(workoutSets.completedAt)),
    db
      .select({
        id: exercisePresets.id,
        name: exercisePresets.name,
        defaultWeightKg: exercisePresets.defaultWeightKg,
        defaultReps: exercisePresets.defaultReps,
      })
      .from(exercisePresets)
      .where(eq(exercisePresets.deviceId, deviceId))
      .orderBy(desc(exercisePresets.updatedAt)),
  ]);

  return Response.json({ records, presets });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid workout set" }, { status: 400 });
  }

  const payload =
    body && typeof body === "object"
      ? (body as { deviceId?: unknown; record?: unknown })
      : {};
  const deviceId = typeof payload.deviceId === "string" ? payload.deviceId.trim() : "";
  const record = parseRecord(payload.record);
  if (!deviceId || !record) {
    return Response.json({ error: "Invalid workout set" }, { status: 400 });
  }

  const db = getDb();
  const [existingRecord] = await db
    .select({ deviceId: workoutSets.deviceId })
    .from(workoutSets)
    .where(eq(workoutSets.id, record.id))
    .limit(1);
  if (existingRecord && existingRecord.deviceId !== deviceId) {
    return Response.json({ error: "Record id belongs to another device" }, { status: 409 });
  }
  const presetId = `${deviceId}:${record.exercise}`;
  const updatedAt = Date.now();
  await db.batch([
    db
      .insert(workoutSets)
      .values({
        id: record.id,
        deviceId,
        workoutDate: record.workoutDate,
        completedAt: record.completedAt,
        exercise: record.exercise,
        weightKg: record.weightKg,
        reps: record.reps,
        heartRateBpm: record.heartRateBpm,
      })
      .onConflictDoUpdate({
        target: workoutSets.id,
        set: {
          workoutDate: record.workoutDate,
          completedAt: record.completedAt,
          exercise: record.exercise,
          weightKg: record.weightKg,
          reps: record.reps,
          heartRateBpm: record.heartRateBpm,
        },
        setWhere: eq(workoutSets.deviceId, deviceId),
      }),
    db
      .insert(exercisePresets)
      .values({
        id: presetId,
        deviceId,
        name: record.exercise,
        defaultWeightKg: record.weightKg,
        defaultReps: record.reps,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [exercisePresets.deviceId, exercisePresets.name],
        set: {
          defaultWeightKg: record.weightKg,
          defaultReps: record.reps,
          updatedAt,
        },
      }),
  ]);

  return Response.json({
    preset: {
      id: presetId,
      name: record.exercise,
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

  const db = getDb();
  await db
    .delete(workoutSets)
    .where(and(eq(workoutSets.id, id), eq(workoutSets.deviceId, deviceId)))
    .run();
  return Response.json({ ok: true });
}
