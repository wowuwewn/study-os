import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { StudyDashboard } from "../domain/models";
import { loadStudyDashboard, STUDY_DATA_CHANGED_EVENT } from "./studyData";

export function useStudyDashboard(options?: { recoverRunningSessions?: boolean }) {
  const [dashboard, setDashboard] = useState<StudyDashboard | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const recoverRunningSessions = options?.recoverRunningSessions ?? false;
  const hasAppliedRestartRecovery = useRef(false);

  const reload = useCallback(async () => {
    try {
      const shouldRecover = recoverRunningSessions && !hasAppliedRestartRecovery.current;
      if (shouldRecover) hasAppliedRestartRecovery.current = true;
      const next = await loadStudyDashboard({ recoverRunningSessions: shouldRecover });
      setDashboard(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
    }
  }, [recoverRunningSessions]);

  useEffect(() => {
    void reload();
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void listen(STUDY_DATA_CHANGED_EVENT, () => void reload()).then((unlisten) => {
      if (cancelled) unlisten();
      else cleanup = unlisten;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [reload]);

  return { dashboard, error, reload };
}
