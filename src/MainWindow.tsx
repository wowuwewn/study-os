import { useEffect, useState, type ReactNode } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { StudyEvent, StudyTask, TaskStep } from "./domain/models";
import { setTaskStepCompleted, FOCUS_COMMAND_EVENT } from "./data/studyData";
import { useStudyDashboard } from "./data/useStudyDashboard";

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

const BASELINE_DUE_AT = Date.parse("2026-09-11T14:59:00.000Z");

function formatLocalTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatEventTime(event: StudyEvent) {
  const start = formatLocalTime(event.startAt);
  return event.endAt ? `${start} – ${formatLocalTime(event.endAt)}` : start;
}

function getTaskDuePresentation(task: StudyTask) {
  if (!task.dueAt && task.estimatedMinutes) {
    return { due: `${task.estimatedMinutes}분`, tone: "duration" };
  }
  if (!task.dueAt) return { due: "", tone: "duration" };
  const days = Math.max(0, Math.round((Date.parse(task.dueAt) - BASELINE_DUE_AT) / 86_400_000));
  return days === 0
    ? { due: "오늘", tone: "today" }
    : { due: `D-${days}`, tone: "deadline" };
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
  const [memo, setMemo] = useState("");
  const { dashboard, error } = useStudyDashboard();

  useEffect(() => {
    if (error) console.error("Study OS data load failed", error);
  }, [error]);

  const quest = dashboard?.currentQuest;
  const timelineEvents = dashboard
    ? dashboard.timelineEvents
        .filter((event) => event.eventType !== "personal")
        .slice(0, 3)
        .map((event) => ({
          id: event.id,
          time: formatEventTime(event),
          title: event.title,
          place: event.location ?? "",
        }))
    : LOADING_EVENTS;
  const nextEvent = dashboard?.timelineEvents.find((event) => event.eventType === "personal");
  const todayTasks = dashboard
    ? dashboard.todayTasks.map((task) => ({ id: task.id, title: task.title, ...getTaskDuePresentation(task) }))
    : LOADING_TASKS;
  const checklist: Array<Pick<TaskStep, "id" | "title" | "isCompleted">> =
    quest?.steps ?? LOADING_STEPS;
  const isRunning = dashboard?.activeFocusSession?.status === "running";

  const minimizeWindow = () => getCurrentWindow().minimize().catch(console.error);
  const toggleMaximize = () =>
    getCurrentWindow().toggleMaximize().catch(console.error);
  const hideWindow = () => getCurrentWindow().hide().catch(console.error);

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
          <button type="button" aria-label="닫기" onClick={hideWindow}>
            <MainIcon name="close" />
          </button>
        </div>
      </header>

      <nav className="main-navigation" aria-label="Study OS 섹션">
        <div className="main-tabs">
          {["오늘", "주간", "과제", "노트"].map((tab, index) => (
            <button
              className={index === 0 ? "main-tab main-tab--active" : "main-tab"}
              type="button"
              key={tab}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="main-tools">
          <button className="main-tool-button" type="button" aria-label="검색">
            <MainIcon name="search" />
          </button>
          <button className="main-add-button" type="button">
            <MainIcon name="add" />
            <span>추가</span>
          </button>
          <button className="main-tool-button" type="button" aria-label="설정">
            <MainIcon name="settings" />
          </button>
        </div>
      </nav>

      <div className="main-content">
        <section className="today-pane" aria-labelledby="today-heading">
          <header className="today-heading">
            <h1 id="today-heading">9월 11일</h1>
            <span>금요일</span>
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
              <time>17:24</time>
              <strong>지금</strong>
            </li>

            <li className="timeline-current-quest">
              <button type="button">
                <span className="quest-radio" aria-hidden="true" />
                <span className="timeline-current-copy">
                  <strong>{quest?.title ?? " "}</strong>
                  <small>{quest?.notes ?? " "}</small>
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
                  <button className="task-check" type="button" aria-label={`${task.title} 완료`} />
                  <span>{task.title}</span>
                  <small className={`task-due task-due--${task.tone}`}>{task.due}</small>
                </li>
              ))}
            </ul>
          </section>

          <footer className="today-footer">지금 하는 게, 나중의 나를 만든다.</footer>
        </section>

        <div className="detail-pane">
          <aside className="quest-detail" aria-labelledby="quest-detail-heading">
            <div className="quest-category">공부</div>
            <h2 id="quest-detail-heading">{quest?.title ?? " "}</h2>
            <p className="quest-detail-subtitle">{quest?.notes ?? " "}</p>

            <dl className="quest-metadata">
              <div>
                <dt><MainIcon name="clock" /><span className="sr-only">예상 시간</span></dt>
                <dd>{quest?.estimatedMinutes ? `예상 ${quest.estimatedMinutes}분` : "예상 시간 미정"}</dd>
              </div>
              <div>
                <dt><MainIcon name="book" /><span className="sr-only">학습 유형</span></dt>
                <dd>개인학습</dd>
              </div>
              <div>
                <dt><MainIcon name="document" /><span className="sr-only">자료</span></dt>
                <dd>강의자료 2-1</dd>
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
                      disabled={!dashboard}
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
              disabled={!dashboard}
            >
              <MainIcon name="play" />
              <span>{isRunning ? "일시정지" : "시작하기"}</span>
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
      </div>
      {error && <p className="sr-only" role="alert">로컬 데이터를 불러오지 못했습니다.</p>}
    </main>
  );
}
