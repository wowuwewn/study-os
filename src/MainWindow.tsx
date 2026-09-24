import { useEffect, useRef, useState, type ReactNode } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ScheduleOccurrence, StudyDashboard, StudyTask, TaskStep } from "./domain/models";
import { setTaskStepCompleted, notifyStudyDataChanged, FOCUS_COMMAND_EVENT } from "./data/studyData";
import { useStudyDashboard } from "./data/useStudyDashboard";
import { showQuickAddWindow } from "./features/quick-add/window";
import IcalSettingsPanel from "./features/ical-sync/IcalSettingsPanel";
import TasksView from "./features/tasks/TasksView";
import { setTaskItemOutcome } from "./features/tasks/service";
import WeekView from "./features/week/WeekView";

type MainTab = "today" | "week" | "tasks" | "notes";

type MainIconName =
  | "add"
  | "book"
  | "check"
  | "chevron"
  | "clock"
  | "close"
  | "document"
  | "maximize"
  | "minimize"
  | "play"
  | "search"
  | "settings";

function MainIcon({ name }: { name: MainIconName }) {
  const paths: Record<MainIconName, ReactNode> = {
    add: <path d="M8 3v10M3 8h10" />,
    book: (
      <>
        <path d="m2.5 5.5 5.5-3 5.5 3L8 8.5Z" />
        <path d="M4.5 7v3.2c1.8 1.5 5.2 1.5 7 0V7" />
      </>
    ),
    check: <path d="m3.5 8 2.8 2.8 6.2-6.3" />,
    chevron: <path d="m6 3.5 4.5 4.5L6 12.5" />,
    clock: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 4.5V8l2.2 1.5" />
      </>
    ),
    close: <path d="m4.5 4.5 7 7m0-7-7 7" />,
    document: (
      <>
        <path d="M4 2.5h5l3 3v8H4Z" />
        <path d="M9 2.5v3h3M6.2 8h3.6M6.2 10.5h3.6" />
      </>
    ),
    maximize: <rect x="4" y="4" width="8" height="8" rx=".5" />,
    minimize: <path d="M4 8h8" />,
    play: <path d="m6 4.5 6 3.5-6 3.5Z" />,
    search: (
      <>
        <circle cx="7" cy="7" r="4.5" />
        <path d="m10.5 10.5 3 3" />
      </>
    ),
    settings: (
      <>
        <circle cx="8" cy="8" r="2.3" />
        <path d="M8 2.2v1.4M8 12.4v1.4M2.2 8h1.4M12.4 8h1.4M3.9 3.9l1 1M11.1 11.1l1 1M12.1 3.9l-1 1M4.9 11.1l-1 1" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      {paths[name]}
    </svg>
  );
}

function formatLocalTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatEventTime(event: ScheduleOccurrence) {
  if (event.timeKind === "date") return "종일";
  const start = formatLocalTime(event.startAt);
  return event.endAt ? `${start} – ${formatLocalTime(event.endAt)}` : start;
}

function startOfLocalDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getTaskDuePresentation(task: StudyTask, now: Date) {
  if (!task.dueAt && task.estimatedMinutes) {
    return { due: `${task.estimatedMinutes}분`, tone: "duration" };
  }
  if (!task.dueAt) return { due: "", tone: "duration" };
  const dueDay = startOfLocalDay(new Date(task.dueAt));
  const today = startOfLocalDay(now);
  const days = Math.max(0, Math.round((dueDay.getTime() - today.getTime()) / 86_400_000));
  return days === 0
    ? { due: "오늘", tone: "today" }
    : { due: `D-${days}`, tone: "deadline" };
}

function recommendationSummary(reasons: string[] | undefined, fallback: string | null | undefined) {
  return reasons?.length ? reasons.join(" · ") : fallback ?? " ";
}

function formatLastSafeStart(value: NonNullable<StudyDashboard["currentQuest"]>["lastSafeStart"], now: Date) {
  if (!value) return "예상 시간 또는 마감 필요";
  if (value.status === "at_risk" || !value.startAt) return "안전 시작 시점을 지났어요";
  const start = new Date(value.startAt);
  const dateKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = dateKey(start) === dateKey(now)
    ? "오늘"
    : dateKey(start) === dateKey(tomorrow)
      ? "내일"
      : new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(start);
  return `안전하게 시작할 마지막 시점: ${day} ${formatLocalTime(value.startAt)}`;
}

const LOADING_EVENTS = Array.from({ length: 3 }, (_, index) => ({
  id: `loading-event-${index}`,
  time: " ",
  title: " ",
  place: " ",
}));

const LOADING_TASKS = Array.from({ length: 3 }, (_, index) => ({
  id: `loading-task-${index}`,
  title: " ",
  due: " ",
  tone: "duration",
}));

const LOADING_STEPS = Array.from({ length: 4 }, (_, index) => ({
  id: `loading-step-${index}`,
  title: " ",
  isCompleted: false,
}));

export default function MainWindow() {
  const [activeTab, setActiveTab] = useState<MainTab>("today");
  const [memo, setMemo] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [taskCompletionError, setTaskCompletionError] = useState<string | null>(null);
  const completingTaskIdRef = useRef<string | null>(null);
  const { dashboard, error, reload } = useStudyDashboard();

  const completeTodayTask = async (taskId: string) => {
    if (completingTaskIdRef.current) return;
    completingTaskIdRef.current = taskId;
    setCompletingTaskId(taskId);
    setTaskCompletionError(null);
    try {
      await setTaskItemOutcome({ kind: "task", entityId: taskId }, "complete");
      await notifyStudyDataChanged();
      await reload();
    } catch (reason) {
      setTaskCompletionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      completingTaskIdRef.current = null;
      setCompletingTaskId(null);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (error) console.error("Study OS data load failed", error);
  }, [error]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      void getCurrentWindow().minimize();
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else cleanup = unlisten;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const quest = dashboard?.currentQuest;
  const questSummary = recommendationSummary(quest?.reasons, quest?.notes);
  const timelineEvents = dashboard
    ? dashboard.timelineEvents
        .filter((event) => Date.parse(event.startAt) <= now.getTime())
        .slice(-3)
        .map((event) => ({
          id: event.id,
          time: formatEventTime(event),
          title: event.title,
          place: event.location ?? "",
        }))
    : LOADING_EVENTS;
  const nextEvent = dashboard?.timelineEvents.find((event) => Date.parse(event.startAt) > now.getTime());
  const todayTasks = dashboard
    ? dashboard.todayTasks.map((task) => ({ id: task.id, title: task.title, ...getTaskDuePresentation(task, now) }))
    : LOADING_TASKS;
  const checklist: Array<Pick<TaskStep, "id" | "title" | "isCompleted">> =
    quest?.steps ?? LOADING_STEPS;
  const isRunning = dashboard?.activeFocusSession?.status === "running";
  const dateHeading = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  }).format(now);
  const weekdayHeading = new Intl.DateTimeFormat("ko-KR", { weekday: "long" }).format(now);

  const minimizeWindow = () => getCurrentWindow().minimize().catch(console.error);
  const toggleMaximize = () =>
    getCurrentWindow().toggleMaximize().catch(console.error);
  const closeToTaskbar = () => getCurrentWindow().minimize().catch(console.error);

  return (
    <main className="main-window">
      <header className="main-titlebar" data-tauri-drag-region>
        <div className="main-brand" data-tauri-drag-region>
          <span className="main-brand-mark" aria-hidden="true" />
          <span>Study OS</span>
        </div>
        <div className="main-window-actions">
          <button type="button" aria-label="최소화" onClick={minimizeWindow}>
            <MainIcon name="minimize" />
          </button>
          <button type="button" aria-label="최대화 전환" onClick={toggleMaximize}>
            <MainIcon name="maximize" />
          </button>
          <button type="button" aria-label="닫기" onClick={closeToTaskbar}>
            <MainIcon name="close" />
          </button>
        </div>
      </header>

      <nav className="main-navigation" aria-label="Study OS 섹션">
        <div className="main-tabs">
          {([
            ["today", "오늘"],
            ["week", "주간"],
            ["tasks", "과제"],
            ["notes", "노트"],
          ] as Array<[MainTab, string]>).map(([tab, label]) => (
            <button
              className={activeTab === tab ? "main-tab main-tab--active" : "main-tab"}
              type="button"
              key={tab}
              aria-current={activeTab === tab ? "page" : undefined}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="main-tools">
          <button className="main-tool-button" type="button" aria-label="검색">
            <MainIcon name="search" />
          </button>
          <button className="main-add-button" type="button" onClick={() => void showQuickAddWindow()}>
            <MainIcon name="add" />
            <span>추가</span>
          </button>
          <button
            className="main-tool-button"
            type="button"
            aria-label="설정"
            onClick={() => setSettingsOpen(true)}
          >
            <MainIcon name="settings" />
          </button>
        </div>
      </nav>

      <div className={activeTab === "today" ? "main-content" : "main-content main-content--alternate"}>
        {activeTab === "today" ? (
          <>
          <section className="today-pane" aria-labelledby="today-heading">
          <header className="today-heading">
            <h1 id="today-heading">{dateHeading}</h1>
            <span>{weekdayHeading}</span>
          </header>

          <ol className="timeline" aria-label="오늘의 일정">
            {timelineEvents.map((item, index) => (
              <li className={`timeline-item timeline-item--${index + 1}`} key={item.id}>
                <span className="timeline-dot" aria-hidden="true" />
                <time>{item.time}</time>
                <strong>{item.title}</strong>
                <span className="timeline-place">{item.place}</span>
              </li>
            ))}

            <li className="timeline-item timeline-item--now">
              <span className="timeline-dot" aria-hidden="true" />
              <time>{formatLocalTime(now.toISOString())}</time>
              <strong>지금</strong>
            </li>

            <li className="timeline-current-quest">
              <button type="button">
                <span className="quest-radio" aria-hidden="true" />
                <span className="timeline-current-copy">
                  <strong>{quest?.title ?? " "}</strong>
                  <small>{questSummary}</small>
                </span>
                <span className="timeline-current-duration">{quest?.estimatedMinutes ? `${quest.estimatedMinutes}분` : " "}</span>
                <MainIcon name="chevron" />
              </button>
            </li>

            <li className="timeline-item timeline-item--last">
              <span className="timeline-dot" aria-hidden="true" />
              <time>{nextEvent ? formatLocalTime(nextEvent.startAt) : " "}</time>
              <strong>{nextEvent?.title ?? " "}</strong>
            </li>
          </ol>

          <section className="today-tasks" aria-labelledby="tasks-heading">
            <header>
              <h2 id="tasks-heading">할 일</h2>
              <span>{todayTasks.length}</span>
            </header>
            <ul>
              {todayTasks.map((task) => (
                <li key={task.id}>
                  <button
                    className="task-check"
                    type="button"
                    aria-label={`${task.title} 완료`}
                    disabled={completingTaskId !== null}
                    onClick={() => void completeTodayTask(task.id)}
                  />
                  <span>{task.title}</span>
                  <small className={`task-due task-due--${task.tone}`}>{task.due}</small>
                </li>
              ))}
            </ul>
            {taskCompletionError && <p className="today-task-message" role="alert">{taskCompletionError}</p>}
          </section>

          <footer className="today-footer">지금 하는 게, 나중의 나를 만든다.</footer>
        </section>

          <div className="detail-pane">
          <aside className="quest-detail" aria-labelledby="quest-detail-heading">
            <div className="quest-category">{quest?.kind === "assignment" ? "과제" : quest?.kind === "prepare_next_event" ? "준비" : "공부"}</div>
            <h2 id="quest-detail-heading">{quest?.title ?? " "}</h2>
            <p className="quest-detail-subtitle">{questSummary}</p>

            <dl className="quest-metadata">
              <div>
                <dt><MainIcon name="clock" /><span className="sr-only">예상 시간</span></dt>
                <dd>{quest?.estimatedMinutes ? `예상 ${quest.estimatedMinutes}분` : "예상 시간 미정"}</dd>
              </div>
              <div>
                <dt><MainIcon name="book" /><span className="sr-only">학습 유형</span></dt>
                <dd>{quest?.kind === "assignment" ? "연결 과제" : quest?.kind === "prepare_next_event" ? "고정 일정 준비" : "개인학습"}</dd>
              </div>
              <div>
                <dt><MainIcon name="document" /><span className="sr-only">자료</span></dt>
                <dd className="quest-last-safe-start">{formatLastSafeStart(quest?.lastSafeStart ?? null, now)}</dd>
              </div>
            </dl>

            <section className="detail-checklist" aria-labelledby="checklist-heading">
              <header>
                <h3 id="checklist-heading">체크리스트</h3>
                <span>{checklist.filter((item) => item.isCompleted).length} / {checklist.length}</span>
              </header>
              <div className="detail-checklist-items">
                {checklist.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={item.isCompleted}
                      disabled={!quest?.taskId}
                      onChange={() => void setTaskStepCompleted(item.id, !item.isCompleted)}
                    />
                    <span className="detail-checkbox" aria-hidden="true">
                      <MainIcon name="check" />
                    </span>
                    <span>{item.title}</span>
                  </label>
                ))}
              </div>
            </section>

            <button
              className="detail-start-button"
              type="button"
              onClick={() => void emitTo("pip", FOCUS_COMMAND_EVENT, { action: "toggle" })}
              disabled={!quest?.focusable}
            >
              <MainIcon name="play" />
              <span>{isRunning ? "일시정지" : quest?.focusable ? "시작하기" : "지금은 준비 시간"}</span>
              <span aria-hidden="true">⌄</span>
            </button>

            <label className="memo-field">
              <span>ↄ&nbsp;&nbsp;메모</span>
              <textarea
                value={memo}
                onChange={(event) => setMemo(event.currentTarget.value)}
                placeholder="여기에 간단한 메모를..."
              />
            </label>
          </aside>
          </div>
          </>
        ) : activeTab === "week" ? (
          <WeekView />
        ) : activeTab === "tasks" ? (
          <TasksView />
        ) : (
          <section className="notes-placeholder" aria-labelledby="notes-heading">
            <span>NOTES</span>
            <h1 id="notes-heading">노트는 다음 단계에서 만나요.</h1>
            <p>이번 milestone은 주간 보기, 과제, 집중 기록에 집중했어요.</p>
          </section>
        )}
      </div>
      {error && <p className="sr-only" role="alert">로컬 데이터를 불러오지 못했습니다.</p>}
      {settingsOpen && <IcalSettingsPanel onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
