import Database from "@tauri-apps/plugin-sql";
import { RECOVER_RUNNING_SESSIONS_SQL, RECOVER_RUNNING_TASKS_SQL } from "./sql";
import {
  SAMPLE_SEED_KEY,
  SAMPLE_SEED_STATEMENTS,
  SAMPLE_SEED_VERSION,
} from "./seedData";

export const DATABASE_URL = "sqlite:study-os.db";

let databasePromise: Promise<Database> | null = null;
let seedPromise: Promise<void> | null = null;

export function utcNow(): string {
  return new Date().toISOString();
}

export function createEntityId(): string {
  return crypto.randomUUID();
}

export async function getDatabase(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = Database.load(DATABASE_URL).then(async (database) => {
      await database.execute("PRAGMA foreign_keys = ON");
      await database.execute("PRAGMA busy_timeout = 5000");
      return database;
    });
  }
  return databasePromise;
}

async function seedIfEmpty(): Promise<void> {
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    const database = await getDatabase();
    const marker = await database.select<Array<{ value: string }>>(
      "SELECT value FROM app_meta WHERE key = ?1",
      [SAMPLE_SEED_KEY],
    );
    if (marker.length > 0) return;

    const [{ total }] = await database.select<Array<{ total: number }>>(`SELECT
      (SELECT COUNT(*) FROM sources) +
      (SELECT COUNT(*) FROM courses) +
      (SELECT COUNT(*) FROM events) +
      (SELECT COUNT(*) FROM assignments) +
      (SELECT COUNT(*) FROM study_tasks) +
      (SELECT COUNT(*) FROM focus_sessions) AS total`);

    if (total === 0) {
      for (const statement of SAMPLE_SEED_STATEMENTS) {
        await database.execute(statement.sql, statement.values);
      }
    }

    const now = utcNow();
    await database.execute(
      `INSERT INTO app_meta (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [SAMPLE_SEED_KEY, total === 0 ? SAMPLE_SEED_VERSION : "skipped-nonempty", now],
    );
  })();

  return seedPromise;
}

export async function initializeStudyDatabase(options?: {
  recoverRunningSessions?: boolean;
}): Promise<void> {
  await seedIfEmpty();
  if (!options?.recoverRunningSessions) return;

  const database = await getDatabase();
  const now = utcNow();
  await database.execute(RECOVER_RUNNING_TASKS_SQL, [now]);
  await database.execute(RECOVER_RUNNING_SESSIONS_SQL, [now]);
}
