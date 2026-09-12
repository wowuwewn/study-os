import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";

type SessionState = "idle" | "running" | "paused" | "completing";

type Quest = {
  id: string;
  title: string;
  durationMinutes: number;
  topic: string;
  checklist: string[];
};

type RunnerProps = {
  progress: number;
  state: SessionState;
};

const INITIAL_QUESTS: Quest[] = [
  {
    id: "java-basics",
    title: "Java 기초 복습",
    durationMinutes: 45,
    topic: "조건문, 반복문 정리",
    checklist: ["조건문 개념 정리", "반복문 개념 정리", "예제 2-1 실습", "문제 3개"],
  },
  {
    id: "algorithm-practice",
    title: "알고리즘 문제 풀이",
    durationMinutes: 30,
    topic: "배열, 문자열 문제 풀이",
    checklist: ["개념 노트 읽기", "문제 2개"],
  },
  {
    id: "os-notes",
    title: "운영체제 노트 정리",
    durationMinutes: 25,
    topic: "프로세스, 스레드 노트",
    checklist: ["강의 노트 복기", "핵심 문장 5개"],
  },
];

function PipIcon({
  name,
}: {
  name: "check" | "close" | "open" | "pause" | "play";
}) {
  const paths = {
    check: <path d="m3.5 8 2.8 2.8 6.2-6.3" />,
    close: <path d="m4.5 4.5 7 7m0-7-7 7" />,
    open: (
      <>
        <path d="M8.5 3.5h4v4" />
        <path d="m12.2 3.8-5.1 5.1" />
        <path d="M11 9.5v2H4.5v-6h2" />
      </>
    ),
    pause: (
      <>
        <path d="M5.5 4.5v7" />
        <path d="M10.5 4.5v7" />
      </>
    ),
    play: <path d="m6 4.5 6 3.5-6 3.5Z" />,
  };

  return (
    <svg className={`icon icon--${name}`} aria-hidden="true" viewBox="0 0 16 16">
      {paths[name]}
    </svg>
  );
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i />
    </span>
  );
}

function Runner({ progress, state }: RunnerProps) {
  const position = Math.min(98, Math.max(2, progress));

  return (
    <span
      className="runner-position"
      style={{ left: `${position}%` }}
      aria-hidden="true"
    >
      <span className={`runner-marker runner-marker--${state}`} />
    </span>
  );
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function PipWindow() {
  const [quests, setQuests] = useState(INITIAL_QUESTS);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const completionTimer = useRef<number | undefined>(undefined);

  const currentQuest = quests[0];
  const totalSeconds = currentQuest.durationMinutes * 60;
  const progress = Math.min(100, (elapsedSeconds / totalSeconds) * 100);
  const currentTime = useMemo(
    () =>
      new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date()),
    [],
  );
  const statusLabel = useMemo(() => {
    if (sessionState === "running") return "집중";
    if (sessionState === "paused") return "멈춤";
    if (sessionState === "completing") return "완료";
    return "지금";
  }, [sessionState]);

  useEffect(() => {
    if (sessionState !== "running") return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((seconds) => {
        const next = Math.min(totalSeconds, seconds + 1);
        if (next === totalSeconds) setSessionState("paused");
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sessionState, totalSeconds]);

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

  const toggleSession = () => {
    if (isCompleting) return;
    setSessionState((state) => (state === "running" ? "paused" : "running"));
  };

  const completeQuest = () => {
    if (isCompleting) return;
    const completedTitle = currentQuest.title;
    setSessionState("completing");
    setElapsedSeconds(totalSeconds);
    setIsCompleting(true);

    completionTimer.current = window.setTimeout(() => {
      setQuests((current) => {
        const [completed, ...rest] = current;
        return [...rest, completed];
      });
      setElapsedSeconds(0);
      setSessionState("idle");
      setIsCompleting(false);
      setAnnouncement(`${completedTitle} 완료. 다음 퀘스트로 이동했습니다.`);
    }, 420);
  };

  const closeWindow = () => getCurrentWindow().close().catch(console.error);

  const handlePipClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    void openMainWindow();
  };

  return (
    <main className="study-pip" onClick={handlePipClick}>
      <header className="pip-titlebar" data-tauri-drag-region>
        <div className="brand brand--pip" data-tauri-drag-region>
          <BrandMark />
          <span>Study OS</span>
        </div>
        <div className="pip-window-actions">
          <button
            className="pip-window-button"
            type="button"
            aria-label="Study OS 열기"
            title="Study OS 열기"
            onClick={openMainWindow}
          >
            <PipIcon name="open" />
          </button>
          <button
            className="pip-window-button pip-window-button--close"
            type="button"
            aria-label="닫기"
            onClick={closeWindow}
          >
            <PipIcon name="close" />
          </button>
        </div>
      </header>

      <section className="pip-quest-panel" aria-label="현재 퀘스트">
        <div className="status-line">
          <span className={`status-dot status-dot--${sessionState}`} />
          <span>{statusLabel}</span>
          <span aria-hidden="true">·</span>
          <time>{currentTime}</time>
        </div>

        <div className="task-block">
          <div className="quest-viewport">
            {quests.slice(0, 2).map((quest, index) => (
              <div
                className={`quest-row ${index === 0 && isCompleting ? "quest-row--leaving" : ""}`}
                key={quest.id}
              >
                <h1>{quest.title}</h1>
                <span>{quest.durationMinutes}분</span>
              </div>
            ))}
          </div>
          <p className="task-description">{currentQuest.topic}</p>
        </div>

        <div className="progress-block">
          <div className="progress-row">
            <div className="track" aria-label={`${Math.round(progress)}% 진행`}>
              <span className="track-fill" style={{ width: `${progress}%` }} />
              <Runner progress={progress} state={sessionState} />
            </div>
            <div className="quest-controls">
              <button
                className="control-button control-button--complete"
                type="button"
                aria-label="퀘스트 완료"
                title="퀘스트 완료"
                onClick={completeQuest}
                disabled={isCompleting}
              >
                <PipIcon name="check" />
              </button>
              <button
                className="control-button control-button--session"
                type="button"
                aria-label={sessionState === "running" ? "일시정지" : "시작"}
                title={sessionState === "running" ? "일시정지" : "시작"}
                onClick={toggleSession}
                disabled={isCompleting}
              >
                <PipIcon name={sessionState === "running" ? "pause" : "play"} />
              </button>
            </div>
          </div>
          <div className="elapsed-time">
            <span>{formatDuration(elapsedSeconds)}</span>
            <span aria-hidden="true">/</span>
            <span>{formatDuration(totalSeconds)}</span>
          </div>
        </div>
      </section>

      <footer className="next-event">
        <span className="next-event-label">다음</span>
        <time dateTime="18:30">18:30</time>
        <span>개인 일정</span>
      </footer>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </main>
  );
}
