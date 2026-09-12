import { useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

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

function MainBrandMark() {
  return (
    <span className="main-brand-mark" aria-hidden="true">
      <i />
    </span>
  );
}

const TIMELINE_ITEMS = [
  { time: "09:00 – 10:15", title: "자연어처리", place: "미래관 503호" },
  { time: "12:30 – 13:45", title: "오픈소스AI응용", place: "e-Campus" },
  { time: "15:00 – 16:15", title: "멀티미디어신호처리", place: "공학관 305호" },
];

const TODAY_TASKS = [
  { title: "자바 IDE 설치 및 프로젝트 생성", due: "오늘", tone: "peach" },
  { title: "알고리즘 문제 3개", due: "내일", tone: "blue" },
  { title: "강의 노트 정리", due: "9/13", tone: "sage" },
];

const CHECKLIST = [
  "조건문 개념 정리",
  "반복문 개념 정리",
  "예제 2-1 실습",
  "문제 3개",
];

export default function MainWindow() {
  const [checkedItems, setCheckedItems] = useState([true, true, false, false]);
  const [isRunning, setIsRunning] = useState(false);
  const [memo, setMemo] = useState("");

  const minimizeWindow = () => getCurrentWindow().minimize().catch(console.error);
  const toggleMaximize = () =>
    getCurrentWindow().toggleMaximize().catch(console.error);
  const hideWindow = () => getCurrentWindow().hide().catch(console.error);

  return (
    <main className="main-window">
      <header className="main-titlebar" data-tauri-drag-region>
        <div className="main-brand" data-tauri-drag-region>
          <MainBrandMark />
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
            {TIMELINE_ITEMS.map((item) => (
              <li className="timeline-item" key={item.time}>
                <span className="timeline-dot" aria-hidden="true" />
                <time>{item.time}</time>
                <strong>{item.title}</strong>
                <span>{item.place}</span>
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
                  <strong>Java 기초 복습</strong>
                  <small>조건문, 반복문 정리</small>
                </span>
                <span className="timeline-current-duration">45분</span>
                <MainIcon name="chevron" />
              </button>
            </li>

            <li className="timeline-item timeline-item--last">
              <span className="timeline-dot" aria-hidden="true" />
              <time>18:30</time>
              <strong>개인 일정</strong>
            </li>
          </ol>

          <section className="today-tasks" aria-labelledby="tasks-heading">
            <header>
              <h2 id="tasks-heading">오늘 할 일</h2>
              <span>3</span>
            </header>
            <ul>
              {TODAY_TASKS.map((task) => (
                <li key={task.title}>
                  <button className="task-check" type="button" aria-label={`${task.title} 완료`} />
                  <span>{task.title}</span>
                  <small className={`task-due task-due--${task.tone}`}>{task.due}</small>
                </li>
              ))}
            </ul>
          </section>
        </section>

        <aside className="quest-detail" aria-labelledby="quest-detail-heading">
          <div className="quest-category">공부</div>
          <h2 id="quest-detail-heading">Java 기초 복습</h2>
          <p className="quest-detail-subtitle">조건문, 반복문 정리</p>

          <dl className="quest-metadata">
            <div>
              <dt><MainIcon name="clock" /><span className="sr-only">예상 시간</span></dt>
              <dd>예상 45분</dd>
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
              <span>{checkedItems.filter(Boolean).length} / {CHECKLIST.length}</span>
            </header>
            <div className="detail-checklist-items">
              {CHECKLIST.map((item, index) => (
                <label key={item}>
                  <input
                    type="checkbox"
                    checked={checkedItems[index]}
                    onChange={() =>
                      setCheckedItems((current) =>
                        current.map((checked, itemIndex) =>
                          itemIndex === index ? !checked : checked,
                        ),
                      )
                    }
                  />
                  <span className="detail-checkbox" aria-hidden="true">
                    <MainIcon name="check" />
                  </span>
                  <span>{item}</span>
                </label>
              ))}
            </div>
          </section>

          <button
            className="detail-start-button"
            type="button"
            onClick={() => setIsRunning((running) => !running)}
          >
            {isRunning ? "일시정지" : "시작하기"}
          </button>

          <label className="memo-field">
            <span>메모</span>
            <textarea
              value={memo}
              onChange={(event) => setMemo(event.currentTarget.value)}
              placeholder="공부하면서 남길 내용을 적어두세요."
            />
          </label>
        </aside>
      </div>
    </main>
  );
}
