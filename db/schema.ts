import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workoutSets = sqliteTable(
  "workout_sets",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id").notNull(),
    workoutDate: text("workout_date").notNull(),
    completedAt: integer("completed_at").notNull(),
    exercise: text("exercise").notNull(),
    weightKg: real("weight_kg").notNull(),
    reps: integer("reps").notNull(),
    heartRateBpm: integer("heart_rate_bpm"),
  },
  (table) => [index("workout_sets_device_date_idx").on(table.deviceId, table.workoutDate)],
);

export const exercisePresets = sqliteTable(
  "exercise_presets",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id").notNull(),
    name: text("name").notNull(),
    defaultWeightKg: real("default_weight_kg").notNull(),
    defaultReps: integer("default_reps").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("exercise_presets_device_name_idx").on(table.deviceId, table.name)],
);
