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

type PipMode = "compact" | "expanded";

type Quest = {
  id: string;
  title: string;
  durationMinutes: number;
  topic: string;
};

const PIP_WIDTH = 312;
const PIP_HEIGHT = { compact: 116, expanded: 194 } as const;
const INITIAL_ELAPSED_SECONDS = 32 * 60 + 14;

const QUESTS: Quest[] = [
  { id: "java-basics", title: "Java 기초 복습", durationMinutes: 45, topic: "조건문, 반복문 정리" },
  { id: "algorithm-practice", title: "알고리즘 문제 풀이", durationMinutes: 30, topic: "배열, 문자열 문제 풀이" },
];

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
  const [questIndex, setQuestIndex] = useState(0);
  const [sessionState, setSessionState] = useState<SessionState>("running");
  const [elapsedSeconds, setElapsedSeconds] = useState(INITIAL_ELAPSED_SECONDS);
  const [checkedItems, setCheckedItems] = useState([true, false]);
  const lastTickAt = useRef(Date.now());
  const completionTimer = useRef<number | undefined>(undefined);
  const snapshotRef = useRef<PetSnapshot>({ state: "running", progress: 0 });

  const currentQuest = QUESTS[questIndex];
  const totalSeconds = currentQuest.durationMinutes * 60;
  const progress = Math.min(100, (elapsedSeconds / totalSeconds) * 100);
  const formattedProgress = formatElapsed(elapsedSeconds);

  const syncElapsedTime = useCallback(() => {
    const now = Date.now();
    const secondsPassed = Math.floor((now - lastTickAt.current) / 1000);
    if (secondsPassed < 1) return;
    lastTickAt.current += secondsPassed * 1000;
    setElapsedSeconds((seconds) => {
      const next = Math.min(totalSeconds, seconds + secondsPassed);
      if (next >= totalSeconds) setSessionState("paused");
      return next;
    });
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

  const toggleSession = () => {
    setSessionState((state) => (state === "running" ? "paused" : "running"));
  };

  const completeQuest = () => {
    if (sessionState === "completing") return;
    setSessionState("completing");
    setElapsedSeconds(totalSeconds);
    completionTimer.current = window.setTimeout(() => {
      setQuestIndex((index) => (index + 1) % QUESTS.length);
      setElapsedSeconds(0);
      setCheckedItems([false, false]);
      setSessionState("idle");
    }, 500);
  };

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

      <h1 className="pip-v02__quest-title">{currentQuest.title}</h1>
      <p className="pip-v02__elapsed">{formattedProgress} / {currentQuest.durationMinutes}</p>
      {pipMode === "expanded" && <p className="pip-v02__topic">{currentQuest.topic}</p>}

      <div className="pip-v02__progress" aria-label={`${Math.round(progress)}% 진행`}>
        <span className="pip-v02__progress-fill" style={{ width: `${progress}%` }} />
        <Runner progress={progress} state={sessionState} />
      </div>

      <button className="pip-v02__session" type="button" onClick={toggleSession} aria-label={sessionState === "running" ? "일시정지" : "시작"}>
        <PipIcon name={sessionState === "running" ? "pause" : "play"} />
      </button>

      {pipMode === "expanded" && (
        <section className="pip-v02__checklist" aria-label="퀘스트 체크리스트">
          {["조건문 개념 정리", "반복문 개념 정리"].map((item, index) => (
            <label key={item}>
              <input
                type="checkbox"
                checked={checkedItems[index]}
                onChange={() => setCheckedItems((items) => items.map((checked, itemIndex) => itemIndex === index ? !checked : checked))}
              />
              <span className="pip-v02__checkbox" aria-hidden="true" />
              <span>{item}</span>
            </label>
          ))}
        </section>
      )}

      <p className="pip-v02__next"><span>다음</span><time dateTime="18:30">18:30</time><span aria-hidden="true">·</span><span>개인 일정</span></p>

      <button className="sr-only" type="button" onClick={completeQuest}>현재 퀘스트 완료</button>
    </main>
  );
}
