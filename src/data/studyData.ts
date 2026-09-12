import { emit } from "@tauri-apps/api/event";
import type { StudyDashboard } from "../domain/models";
import { initializeStudyDatabase } from "./db/client";
import {
  focusSessionRepository,
  studyTaskRepository,
} from "./repositories";
import { listTodaySchedule } from "../features/schedule/service";

export const STUDY_DATA_CHANGED_EVENT = "study-os-data-changed";
export const FOCUS_COMMAND_EVENT = "study-os-focus-command";

export type FocusCommand = { action: "toggle" | "complete" };

export async function loadStudyDashboard(options?: {
  recoverRunningSessions?: boolean;
}): Promise<StudyDashboard> {
  await initializeStudyDatabase(options);
  const [timelineEvents, currentQuest, openTasks, activeFocusSession] = await Promise.all([
    listTodaySchedule(),
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
