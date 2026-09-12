import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import {
  getAllWindows,
  getCurrentWindow,
  currentMonitor,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import {
  PET_RESTORE_EVENT,
  PET_STATE_EVENT,
  PET_STATE_REQUEST_EVENT,
  toPetState,
  type PetSnapshot,
  type SessionState,
} from "./pipState";
import type { FocusSession } from "./domain/models";
import { focusSessionRepository, studyTaskRepository } from "./data/repositories";
import {
  FOCUS_COMMAND_EVENT,
  notifyStudyDataChanged,
  setTaskStepCompleted,
  type FocusCommand,
} from "./data/studyData";
import { useStudyDashboard } from "./data/useStudyDashboard";

type PipMode = "compact" | "expanded";

const PIP_WIDTH = 312;
const PIP_HEIGHT = { compact: 116, expanded: 194 } as const;

function PipIcon({ name }: { name: "close" | "pause" | "play" }) {
  return (
    <svg className={`pip-v02__icon pip-v02__icon--${name}`} aria-hidden="true" viewBox="0 0 16 16">
      {name === "close" && <path d="m4.5 4.5 7 7m0-7-7 7" />}
      {name === "pause" && (
        <>
          <path d="M5.5 4.5v7" />
          <path d="M10.5 4.5v7" />
        </>
      )}
      {name === "play" && <path d="m6 4.5 6 3.5-6 3.5Z" />}
    </svg>
  );
}

function Runner({ progress, state }: { progress: number; state: SessionState }) {
  return (
    <span
      className={`pip-v02__runner pip-v02__runner--${state}`}
      style={{ left: `${Math.min(99, Math.max(1, progress))}%` }}
      aria-hidden="true"
    />
  );
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatLocalTime(isoDateTime: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoDateTime));
}

async function clampPipToWorkArea() {
  const currentWindow = getCurrentWindow();
  const [position, size, monitor] = await Promise.all([
    currentWindow.outerPosition(),
    currentWindow.outerSize(),
    currentMonitor(),
  ]);
  if (!monitor) return;

  const workArea = monitor.workArea;
  const minX = workArea.position.x;
  const minY = workArea.position.y;
  const maxX = minX + workArea.size.width - size.width;
  const maxY = minY + workArea.size.height - size.height;
  const x = Math.min(Math.max(position.x, minX), Math.max(minX, maxX));
  const y = Math.min(Math.max(position.y, minY), Math.max(minY, maxY));

  if (x !== position.x || y !== position.y) {
    await currentWindow.setPosition(new PhysicalPosition(x, y));
  }
}

export default function PipWindow() {
  const [pipMode, setPipMode] = useState<PipMode>("compact");
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [focusSession, setFocusSession] = useState<FocusSession | null>(null);
  const [isFocusMutationPending, setIsFocusMutationPending] = useState(false);
  const { dashboard, error, reload } = useStudyDashboard({ recoverRunningSessions: true });
  const lastTickAt = useRef(Date.now());
  const elapsedSecondsRef = useRef(0);
  const completionTimer = useRef<number | undefined>(undefined);
  const snapshotRef = useRef<PetSnapshot>({ state: "idle", progress: 0 });
  const recoveryAnnouncedRef = useRef(false);
  const toggleSessionRef = useRef<() => Promise<void>>(async () => undefined);
  const completeQuestRef = useRef<() => Promise<void>>(async () => undefined);

  const currentQuest = dashboard?.currentQuest;
  const totalSeconds = (currentQuest?.estimatedMinutes ?? 45) * 60;
  const progress = Math.min(100, (elapsedSeconds / totalSeconds) * 100);
  const formattedProgress = formatElapsed(elapsedSeconds);
  const nextEvent = dashboard?.timelineEvents.find((event) => event.eventType === "personal");
  const visibleSteps = currentQuest?.steps.slice(0, 2) ?? [];

  elapsedSecondsRef.current = elapsedSeconds;

  useEffect(() => {
    if (!dashboard || sessionState === "completing") return;
    const active = dashboard.activeFocusSession;
    setFocusSession(active);
    setElapsedSeconds(active?.elapsedSeconds ?? 0);
    elapsedSecondsRef.current = active?.elapsedSeconds ?? 0;
    setSessionState(active?.status === "running" ? "running" : active?.status === "paused" ? "paused" : "idle");

    if (!recoveryAnnouncedRef.current) {
      recoveryAnnouncedRef.current = true;
      void notifyStudyDataChanged();
    }
  }, [dashboard]);

  useEffect(() => {
    if (error) console.error("Study OS PIP data load failed", error);
  }, [error]);

  const syncElapsedTime = useCallback(() => {
    const now = Date.now();
    const secondsPassed = Math.floor((now - lastTickAt.current) / 1000);
    if (secondsPassed < 1) return elapsedSecondsRef.current;
    lastTickAt.current += secondsPassed * 1000;
    const next = Math.min(totalSeconds, elapsedSecondsRef.current + secondsPassed);
    elapsedSecondsRef.current = next;
    setElapsedSeconds(next);
    if (next >= totalSeconds) setSessionState("paused");
    return next;
  }, [totalSeconds]);

  useEffect(() => {
    if (sessionState !== "running") return;
    lastTickAt.current = Date.now();
    const timer = window.setInterval(syncElapsedTime, 500);
    return () => {
      syncElapsedTime();
      window.clearInterval(timer);
    };
  }, [sessionState, syncElapsedTime]);

  useEffect(() => {
    if (sessionState !== "running" || !focusSession) return;
    const saveTimer = window.setInterval(() => {
      syncElapsedTime();
      void focusSessionRepository.saveElapsed(focusSession.id, elapsedSecondsRef.current);
    }, 5_000);
    return () => window.clearInterval(saveTimer);
  }, [focusSession, sessionState, syncElapsedTime]);

  const petSnapshot = useMemo<PetSnapshot>(
    () => ({ state: toPetState(sessionState), progress }),
    [progress, sessionState],
  );
  snapshotRef.current = petSnapshot;

  useEffect(() => {
    void emitTo("pet", PET_STATE_EVENT, petSnapshot).catch(() => undefined);
  }, [petSnapshot]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    let cancelled = false;

    void listen(PET_STATE_REQUEST_EVENT, () => {
      void emitTo("pet", PET_STATE_EVENT, snapshotRef.current).catch(() => undefined);
    }).then((cleanup) => (cancelled ? cleanup() : cleanups.push(cleanup)));

    void listen(PET_RESTORE_EVENT, async () => {
      const windows = await getAllWindows();
      const petWindow = windows.find((appWindow) => appWindow.label === "pet");
      const currentWindow = getCurrentWindow();
      const petPosition = await petWindow?.outerPosition();

      setPipMode("compact");
      await currentWindow.setSize(new LogicalSize(PIP_WIDTH, PIP_HEIGHT.compact));
      if (petPosition) await currentWindow.setPosition(petPosition);
      await currentWindow.show();
      await clampPipToWorkArea();
      await currentWindow.setFocus();
      await petWindow?.hide();
    }).then((cleanup) => (cancelled ? cleanup() : cleanups.push(cleanup)));

    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(
    () => () => {
      if (completionTimer.current) window.clearTimeout(completionTimer.current);
    },
    [],
  );

  const openMainWindow = async () => {
    const windows = await getAllWindows();
    const mainWindow = windows.find((appWindow) => appWindow.label === "main");
    if (!mainWindow) return;
    await mainWindow.show();
    await mainWindow.unminimize();
    await mainWindow.setFocus();
  };

  const changePipMode = async (mode: PipMode) => {
    if (mode === pipMode) return;
    setPipMode(mode);
    await getCurrentWindow().setSize(new LogicalSize(PIP_WIDTH, PIP_HEIGHT[mode]));
    await clampPipToWorkArea();
  };

  const enterPetMode = async () => {
    const currentWindow = getCurrentWindow();
    const windows = await getAllWindows();
    const petWindow = windows.find((appWindow) => appWindow.label === "pet");
    if (!petWindow) return;

    const position = await currentWindow.outerPosition();
    await emitTo("pet", PET_STATE_EVENT, snapshotRef.current);
    await petWindow.setPosition(position);
    await petWindow.show();
    await petWindow.setFocus();
    await currentWindow.hide();
  };

  const toggleSession = useCallback(async () => {
    if (!currentQuest || isFocusMutationPending || sessionState === "completing") return;
    setIsFocusMutationPending(true);
    try {
      if (sessionState === "running" && focusSession) {
        const elapsed = syncElapsedTime();
        const paused = await focusSessionRepository.pause(
          focusSession.id,
          focusSession.taskId,
          elapsed,
        );
        setFocusSession(paused);
        setSessionState("paused");
      } else {
        const running = focusSession?.status === "paused"
          ? await focusSessionRepository.resume(focusSession.id, focusSession.taskId)
          : await focusSessionRepository.startOrResume(currentQuest, elapsedSecondsRef.current);
        setFocusSession(running);
        lastTickAt.current = Date.now();
        setSessionState("running");
      }
      await notifyStudyDataChanged();
    } catch (reason) {
      console.error("Focus session toggle failed", reason);
    } finally {
      setIsFocusMutationPending(false);
    }
  }, [currentQuest, focusSession, isFocusMutationPending, sessionState, syncElapsedTime]);

  const completeQuest = useCallback(async () => {
    if (!currentQuest || isFocusMutationPending || sessionState === "completing") return;
    setIsFocusMutationPending(true);
    setSessionState("completing");
    elapsedSecondsRef.current = totalSeconds;
    setElapsedSeconds(totalSeconds);
    try {
      if (focusSession) {
        await focusSessionRepository.complete(focusSession.id, focusSession.taskId, totalSeconds);
      } else {
        await studyTaskRepository.setStatus(currentQuest.id, "done");
      }
      await notifyStudyDataChanged();
      completionTimer.current = window.setTimeout(() => {
        setFocusSession(null);
        elapsedSecondsRef.current = 0;
        setElapsedSeconds(0);
        setSessionState("idle");
        setIsFocusMutationPending(false);
        void reload();
      }, 500);
    } catch (reason) {
      console.error("Focus session completion failed", reason);
      setSessionState(focusSession?.status === "running" ? "running" : focusSession ? "paused" : "idle");
      setIsFocusMutationPending(false);
    }
  }, [currentQuest, focusSession, isFocusMutationPending, reload, sessionState, totalSeconds]);

  toggleSessionRef.current = toggleSession;
  completeQuestRef.current = completeQuest;

  useEffect(() => {
    if (
      sessionState !== "paused" ||
      focusSession?.status !== "running" ||
      elapsedSeconds < totalSeconds ||
      isFocusMutationPending
    ) return;

    setIsFocusMutationPending(true);
    void focusSessionRepository
      .pause(focusSession.id, focusSession.taskId, elapsedSeconds)
      .then((paused) => {
        setFocusSession(paused);
        return notifyStudyDataChanged();
      })
      .catch((reason) => console.error("Automatic focus pause failed", reason))
      .finally(() => setIsFocusMutationPending(false));
  }, [elapsedSeconds, focusSession, isFocusMutationPending, sessionState, totalSeconds]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void listen<FocusCommand>(FOCUS_COMMAND_EVENT, (event) => {
      if (event.payload.action === "complete") void completeQuestRef.current();
      else void toggleSessionRef.current();
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else cleanup = unlisten;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const handlePipClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, label, input")) return;
    void openMainWindow();
  };

  return (
    <main className={`study-pip pip-v02 pip-v02--${pipMode}`} onClick={handlePipClick}>
      <div className="pip-v02__tint" data-tauri-drag-region />

      <button className="pip-v02__brand" type="button" onClick={openMainWindow} aria-label="Main Study OS 열기">
        <span className="pip-v02__brand-mark" aria-hidden="true" />
        <span>Study OS</span>
      </button>

      <div className="pip-v02__window-actions">
        {pipMode === "compact" ? (
          <button className="pip-v02__window-button" type="button" onClick={() => void changePipMode("expanded")} aria-label="PIP 펼치기">—</button>
        ) : (
          <button className="pip-v02__window-button" type="button" onClick={() => void enterPetMode()} aria-label="Pet Mode로 전환">
            <img src="/figma/pip-v02/pet-mode-control.svg" alt="" draggable="false" />
          </button>
        )}
        {pipMode === "compact" ? (
          <button className="pip-v02__window-button" type="button" onClick={() => void enterPetMode()} aria-label="Pet Mode로 전환">
            <img src="/figma/pip-v02/pet-mode-control.svg" alt="" draggable="false" />
          </button>
        ) : (
          <button className="pip-v02__window-button pip-v02__collapse" type="button" onClick={() => void changePipMode("compact")} aria-label="PIP 접기">⌃</button>
        )}
        <button className="pip-v02__window-button" type="button" onClick={() => void getCurrentWindow().close()} aria-label="닫기">
          <PipIcon name="close" />
        </button>
      </div>

      <h1 className="pip-v02__quest-title">{currentQuest?.title ?? " "}</h1>
      <p className="pip-v02__elapsed">{formattedProgress} / {currentQuest?.estimatedMinutes ?? 45}</p>
      {pipMode === "expanded" && <p className="pip-v02__topic">{currentQuest?.notes ?? " "}</p>}

      <div className="pip-v02__progress" aria-label={`${Math.round(progress)}% 진행`}>
        <span className="pip-v02__progress-fill" style={{ width: `${progress}%` }} />
        <Runner progress={progress} state={sessionState} />
      </div>

      <button
        className="pip-v02__session"
        type="button"
        onClick={() => void toggleSession()}
        aria-label={sessionState === "running" ? "일시정지" : "시작"}
        disabled={!currentQuest || isFocusMutationPending}
      >
        <PipIcon name={sessionState === "running" ? "pause" : "play"} />
      </button>

      {pipMode === "expanded" && (
        <section className="pip-v02__checklist" aria-label="퀘스트 체크리스트">
          {visibleSteps.map((step) => (
            <label key={step.id}>
              <input
                type="checkbox"
                checked={step.isCompleted}
                onChange={() => void setTaskStepCompleted(step.id, !step.isCompleted)}
              />
              <span className="pip-v02__checkbox" aria-hidden="true" />
              <span>{step.title}</span>
            </label>
          ))}
        </section>
      )}

      <p className="pip-v02__next"><span>다음</span><time dateTime={nextEvent?.startAt}>{nextEvent ? formatLocalTime(nextEvent.startAt) : " "}</time><span aria-hidden="true">·</span><span>{nextEvent?.title ?? " "}</span></p>

      <button className="sr-only" type="button" onClick={() => void completeQuest()}>현재 퀘스트 완료</button>
      {error && <p className="sr-only" role="alert">로컬 데이터를 불러오지 못했습니다.</p>}
    </main>
  );
}
