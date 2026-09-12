import { emit } from "@tauri-apps/api/event";
import type { StudyDashboard } from "../domain/models";
import { initializeStudyDatabase } from "./db/client";
import {
  eventRepository,
  focusSessionRepository,
  studyTaskRepository,
} from "./repositories";

export const STUDY_DATA_CHANGED_EVENT = "study-os-data-changed";
export const FOCUS_COMMAND_EVENT = "study-os-focus-command";

export type FocusCommand = { action: "toggle" | "complete" };

const BASELINE_DAY_START_UTC = "2026-09-11T00:00:00.000Z";
const BASELINE_DAY_END_UTC = "2026-09-12T00:00:00.000Z";

export async function loadStudyDashboard(options?: {
  recoverRunningSessions?: boolean;
}): Promise<StudyDashboard> {
  await initializeStudyDatabase(options);
  const [timelineEvents, currentQuest, openTasks, activeFocusSession] = await Promise.all([
    eventRepository.listBetween(BASELINE_DAY_START_UTC, BASELINE_DAY_END_UTC),
    studyTaskRepository.getCurrentQuest(),
    studyTaskRepository.listOpen(),
    focusSessionRepository.getActive(),
  ]);

  if (!currentQuest) throw new Error("Study OS has no current quest");

  return {
    timelineEvents,
    currentQuest,
    todayTasks: openTasks.filter((task) => task.id !== currentQuest.id).slice(0, 3),
    activeFocusSession,
  };
}

export async function setTaskStepCompleted(stepId: string, completed: boolean): Promise<void> {
  await studyTaskRepository.setStepCompleted(stepId, completed);
  await emit(STUDY_DATA_CHANGED_EVENT);
}

export async function notifyStudyDataChanged(): Promise<void> {
  await emit(STUDY_DATA_CHANGED_EVENT);
}
