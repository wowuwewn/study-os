import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const CDP_URL = "http://127.0.0.1:9222/json";
const TASK_ID = "qa:decision:focus-task";
const CANCEL_TASK_ID = "qa:decision:cancel-task";
const EVENT_ID = "qa:decision:fixed-event";
const PREPARE_EVENT_ID = "qa:decision:prepare-event";
const QUICK_ADD_TITLE = "Decision QA 빠른 추가";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpSession {
  constructor(target) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function poll(read, predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() <= deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await wait(100);
  }
  throw new Error(message);
}

const targets = await (await fetch(CDP_URL)).json();
const entries = await Promise.all(targets.map(async (target) => {
  const session = new CdpSession(target);
  return [await session.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label"), session];
}));
const windows = Object.fromEntries(entries);
assert.deepEqual(Object.keys(windows).sort(), ["calendar", "main", "pet", "pip", "quick-add"]);

const savedVisibility = await windows.main.evaluate(`({
  legacy: localStorage.getItem('study-os:auxiliary-visibility:v1'),
  pip: localStorage.getItem('study-os:pip-visible:v1'),
  calendar: localStorage.getItem('study-os:calendar-visible:v1'),
  mode: localStorage.getItem('study-os:pip-mode:v1')
})`);
const snapshot = await windows.main.evaluate(`(async () => {
  const database = await (await import('/src/data/db/client.ts')).getDatabase();
  const active = (await database.select("SELECT * FROM focus_sessions WHERE status IN ('running', 'paused') LIMIT 1"))[0] ?? null;
  return {
    active,
    activeTask: active?.task_id
      ? (await database.select("SELECT status, completed_at, updated_at FROM study_tasks WHERE id=?1", [active.task_id]))[0] ?? null
      : null,
    activeIntervals: active
      ? await database.select("SELECT * FROM focus_intervals WHERE session_id=?1 ORDER BY started_at, id", [active.id])
      : [],
    decision: (await database.select("SELECT * FROM app_meta WHERE key='decision_engine_current_candidate_v1'"))[0] ?? null,
  };
})()`);

async function cleanup() {
  await windows.main.evaluate(`(async () => {
    const database = await (await import('/src/data/db/client.ts')).getDatabase();
    await database.execute("DELETE FROM focus_sessions WHERE id LIKE 'qa:decision:%' OR task_id LIKE 'qa:decision:%'");
    await database.execute("DELETE FROM task_steps WHERE task_id LIKE 'qa:decision:%'");
    await database.execute("DELETE FROM study_tasks WHERE id LIKE 'qa:decision:%' OR title=?1", [${JSON.stringify(QUICK_ADD_TITLE)}]);
    await database.execute("DELETE FROM events WHERE id IN (?1, ?2)", [${JSON.stringify(EVENT_ID)}, ${JSON.stringify(PREPARE_EVENT_ID)}]);
    const active = ${JSON.stringify(snapshot.active)};
    if (active) {
      await database.execute(
        "UPDATE focus_sessions SET task_id=?1, started_at=?2, ended_at=?3, planned_minutes=?4, elapsed_seconds=?5, status=?6, last_resumed_at=?7, pause_count=?8, created_at=?9, updated_at=?10 WHERE id=?11",
        [active.task_id, active.started_at, active.ended_at, active.planned_minutes, active.elapsed_seconds, active.status, active.last_resumed_at, active.pause_count, active.created_at, active.updated_at, active.id],
      );
      await database.execute("DELETE FROM focus_intervals WHERE session_id=?1", [active.id]);
      for (const interval of ${JSON.stringify(snapshot.activeIntervals)}) {
        await database.execute(
          "INSERT INTO focus_intervals (id, session_id, started_at, ended_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
          [interval.id, interval.session_id, interval.started_at, interval.ended_at, interval.created_at],
        );
      }
      const activeTask = ${JSON.stringify(snapshot.activeTask)};
      if (active.task_id && activeTask) {
        await database.execute(
          "UPDATE study_tasks SET status=?1, completed_at=?2, updated_at=?3 WHERE id=?4",
          [activeTask.status, activeTask.completed_at, activeTask.updated_at, active.task_id],
        );
      }
    }
    const decision = ${JSON.stringify(snapshot.decision)};
    if (decision) {
      await database.execute(
        "INSERT INTO app_meta (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        [decision.key, decision.value, decision.updated_at],
      );
    } else {
      await database.execute("DELETE FROM app_meta WHERE key='decision_engine_current_candidate_v1'");
    }
    await (await import('/src/data/studyData.ts')).notifyStudyDataChanged();
  })()`);
  await windows.main.evaluate(`(async () => {
    const visibility = await import('/src/windowVisibility.ts');
    const saved = ${JSON.stringify(savedVisibility)};
    const legacy = saved.legacy ? JSON.parse(saved.legacy) : { pip: false, calendar: false };
    const pip = saved.pip === 'true' ? true : saved.pip === 'false' ? false : legacy.pip === true;
    const calendar = saved.calendar === 'true' ? true : saved.calendar === 'false' ? false : legacy.calendar === true;
    await visibility.setAuxiliaryWindowVisibility('pip', pip);
    await visibility.setAuxiliaryWindowVisibility('calendar', calendar);
    for (const [key, value] of [
      ['study-os:auxiliary-visibility:v1', saved.legacy],
      ['study-os:pip-visible:v1', saved.pip],
      ['study-os:calendar-visible:v1', saved.calendar],
      ['study-os:pip-mode:v1', saved.mode],
    ]) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
  })()`);
  const restored = await windows.main.evaluate(`(async () => {
    const database = await (await import('/src/data/db/client.ts')).getDatabase();
    const active = (await database.select("SELECT * FROM focus_sessions WHERE status IN ('running', 'paused') LIMIT 1"))[0] ?? null;
    return {
      active,
      activeTask: active?.task_id
        ? (await database.select("SELECT status, completed_at, updated_at FROM study_tasks WHERE id=?1", [active.task_id]))[0] ?? null
        : null,
      activeIntervals: active
        ? await database.select("SELECT * FROM focus_intervals WHERE session_id=?1 ORDER BY started_at, id", [active.id])
        : [],
      visibility: {
        legacy: localStorage.getItem('study-os:auxiliary-visibility:v1'),
        pip: localStorage.getItem('study-os:pip-visible:v1'),
        calendar: localStorage.getItem('study-os:calendar-visible:v1'),
        mode: localStorage.getItem('study-os:pip-mode:v1'),
      },
    };
  })()`);
  assert.deepEqual(restored.active, snapshot.active, "Decision QA must restore the original active FocusSession");
  assert.deepEqual(restored.activeTask, snapshot.activeTask, "Decision QA must restore the active StudyTask state");
  assert.deepEqual(restored.activeIntervals, snapshot.activeIntervals, "Decision QA must restore focus intervals exactly");
  assert.deepEqual(restored.visibility, savedVisibility, "Decision QA must restore visibility preferences exactly");
}

try {
  await windows.main.evaluate("[...document.querySelectorAll('.main-tab')].find((node) => node.textContent === '오늘')?.click()");
  await windows.main.evaluate(`(async () => {
    const database = await (await import('/src/data/db/client.ts')).getDatabase();
    const repositories = await import('/src/data/repositories/index.ts');
    const visibility = await import('/src/windowVisibility.ts');
    const studyData = await import('/src/data/studyData.ts');
    await visibility.setAuxiliaryWindowVisibility('pip', true);
    if (${JSON.stringify(snapshot.active)}?.id) {
      await database.execute("UPDATE focus_sessions SET status='cancelled', ended_at=?1, updated_at=?1 WHERE id=?2", [new Date().toISOString(), ${JSON.stringify(snapshot.active?.id ?? null)}]);
    }
    await database.execute("DELETE FROM focus_sessions WHERE id LIKE 'qa:decision:%' OR task_id LIKE 'qa:decision:%'");
    await repositories.studyTaskRepository.remove(${JSON.stringify(TASK_ID)});
    await repositories.studyTaskRepository.remove(${JSON.stringify(CANCEL_TASK_ID)});
    await repositories.eventRepository.remove(${JSON.stringify(EVENT_ID)});
    await repositories.eventRepository.remove(${JSON.stringify(PREPARE_EVENT_ID)});
    const source = await repositories.sourceRepository.getOrCreateManual();
    const current = Date.now();
    await repositories.studyTaskRepository.save({
      id: ${JSON.stringify(TASK_ID)}, sourceId: source.id, courseId: null, assignmentId: null,
      title: 'Decision QA 집중 작업', notes: '설명 표시 검증', estimatedMinutes: 30,
      priority: 100, status: 'doing', dueAt: '2000-01-01T00:00:00.000Z',
      plannedStartAt: null, completedAt: null,
    });
    await database.execute(
      "INSERT INTO task_steps (id, task_id, title, sort_order, is_completed, completed_at, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 1, ?4, ?4, ?4)",
      ['qa:decision:focus-step', ${JSON.stringify(TASK_ID)}, 'QA 준비 완료', new Date(current).toISOString()],
    );
    await repositories.eventRepository.save({
      id: ${JSON.stringify(EVENT_ID)}, sourceId: source.id, courseId: null, externalId: null,
      eventType: 'class', title: 'Decision QA 다음 수업',
      startAt: new Date(current + 2 * 60 * 60 * 1000).toISOString(),
      endAt: new Date(current + 3 * 60 * 60 * 1000).toISOString(),
      location: null, isFixed: true, notes: null,
    });
    await studyData.notifyStudyDataChanged();
  })()`);

  const titles = await poll(
    async () => ({
      main: await windows.main.evaluate("document.querySelector('#quest-detail-heading')?.textContent"),
      pip: await windows.pip.evaluate("document.querySelector('.pip-v02__quest-title')?.textContent"),
    }),
    (value) => value.main === "Decision QA 집중 작업" && value.pip === value.main,
    "Main/PIP recommendation did not converge on the focus-locked QA task",
  );
  assert.equal(titles.main, titles.pip);
  await windows.pip.evaluate("document.querySelector('.pip-v02__session')?.click()");
  await poll(
    () => windows.main.evaluate(`(async () => (await (await import('/src/data/repositories/index.ts')).focusSessionRepository.getActive())?.status)()`),
    (status) => status === "running",
    "focus start did not persist through the actual PIP control",
  );
  await windows.main.evaluate(`(async () => {
    const repositories = await import('/src/data/repositories/index.ts');
    const database = await (await import('/src/data/db/client.ts')).getDatabase();
    const task = await repositories.studyTaskRepository.get(${JSON.stringify(TASK_ID)});
    await database.execute("UPDATE task_steps SET is_completed=0, completed_at=NULL WHERE task_id=?1", [${JSON.stringify(TASK_ID)}]);
    await repositories.studyTaskRepository.save({
      ...task,
      dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      steps: undefined,
    });
    await (await import('/src/data/studyData.ts')).notifyStudyDataChanged();
  })()`);
  await wait(300);
  const explanation = await windows.main.evaluate(`({
    subtitle: document.querySelector('.quest-detail-subtitle')?.textContent,
    lastSafeStart: document.querySelector('.quest-last-safe-start')?.textContent,
    rawScoreVisible: /raw score|점수\\s*[:：]/i.test(document.body.innerText),
  })`);
  assert.match(explanation.subtitle, /진행 중인 작업 이어서/);
  assert.match(explanation.lastSafeStart, /안전하게 시작할 마지막 시점|안전 시작 시점을 지났어요/);
  assert.equal(explanation.rawScoreVisible, false);

  await windows.pip.evaluate("document.querySelector('[aria-label=\"PIP 펼치기\"]')?.click()");
  await wait(250);
  assert.match(await windows.pip.evaluate("document.querySelector('.pip-v02__topic')?.textContent"), /진행 중인 작업 이어서/);

  await mkdir("qa/.tmp", { recursive: true });
  for (const [name, session, width, height] of [
    ["decision-main", windows.main, 855, 760],
    ["decision-pip", windows.pip, 312, 194],
  ]) {
    const { data } = await session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    await writeFile(`qa/.tmp/${name}.png`, Buffer.from(data, "base64"));
  }

  await windows.pip.evaluate("document.querySelector('.pip-v02__session')?.click()");
  await poll(
    () => windows.main.evaluate(`(async () => (await (await import('/src/data/repositories/index.ts')).focusSessionRepository.getActive())?.status)()`),
    (status) => status === "paused",
    "focus pause did not persist",
  );
  assert.equal(await windows.main.evaluate("document.querySelector('#quest-detail-heading')?.textContent"), "Decision QA 집중 작업");
  await windows.pip.evaluate("document.querySelector('.pip-v02__session')?.click()");
  await poll(
    () => windows.main.evaluate(`(async () => (await (await import('/src/data/repositories/index.ts')).focusSessionRepository.getActive())?.status)()`),
    (status) => status === "running",
    "focus resume did not persist",
  );
  await windows.pip.evaluate("[...document.querySelectorAll('.sr-only')].find((node) => node.textContent?.includes('현재 퀘스트 완료'))?.click()");
  await poll(
    () => windows.main.evaluate(`(async () => ({
      active: await (await import('/src/data/repositories/index.ts')).focusSessionRepository.getActive(),
      task: await (await import('/src/data/repositories/index.ts')).studyTaskRepository.get(${JSON.stringify(TASK_ID)}),
    }))()`),
    (value) => !value.active && value.task?.status === "done",
    "focus completion did not finish the session and task",
  );

  await windows.main.evaluate(`(async () => {
    const repositories = await import('/src/data/repositories/index.ts');
    const source = await repositories.sourceRepository.getOrCreateManual();
    const task = await repositories.studyTaskRepository.save({
      id: ${JSON.stringify(CANCEL_TASK_ID)}, sourceId: source.id, courseId: null, assignmentId: null,
      title: 'Decision QA 취소 작업', notes: null, estimatedMinutes: 20, priority: 100,
      status: 'todo', dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      plannedStartAt: null, completedAt: null,
    });
    const session = await repositories.focusSessionRepository.startOrResume(task, 0);
    await (await import('/src/data/studyData.ts')).notifyStudyDataChanged();
    await repositories.focusSessionRepository.cancel(session.id, 3);
    await (await import('/src/data/studyData.ts')).notifyStudyDataChanged();
  })()`);
  await poll(
    () => windows.main.evaluate(`(async () => (await (await import('/src/data/repositories/index.ts')).focusSessionRepository.getActive()) ?? null)()`),
    (active) => active === null,
    "focus cancellation did not release the hard lock",
  );

  await windows.main.evaluate(`(async () => {
    const repositories = await import('/src/data/repositories/index.ts');
    const source = await repositories.sourceRepository.getOrCreateManual();
    await repositories.eventRepository.save({
      id: ${JSON.stringify(PREPARE_EVENT_ID)}, sourceId: source.id, courseId: null, externalId: null,
      eventType: 'meeting', title: 'Decision QA 곧 시작',
      startAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), endAt: null,
      location: null, isFixed: true, notes: null,
    });
    await (await import('/src/data/studyData.ts')).notifyStudyDataChanged();
  })()`);
  await poll(
    () => windows.main.evaluate("document.querySelector('#quest-detail-heading')?.textContent"),
    (title) => title === "다음 일정 준비하기",
    "prepare_next_event did not replace the idle task recommendation",
  );
  assert.equal(await windows.pip.evaluate("document.querySelector('.pip-v02__session')?.disabled"), true);

  await windows.main.evaluate(`(async () => {
    await (await import('/src/features/quick-add/window.ts')).showQuickAddWindow();
  })()`);
  await wait(250);
  await windows["quick-add"].evaluate(`(() => {
    const input = document.querySelector('.quick-add-form input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(`${QUICK_ADD_TITLE} 20분`)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  })()`);
  await windows["quick-add"].send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter" });
  await windows["quick-add"].send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter" });
  await poll(
    () => windows.main.evaluate(`(async () => (await (await import('/src/data/repositories/index.ts')).studyTaskRepository.listOpen()).some((task) => task.title === ${JSON.stringify(QUICK_ADD_TITLE)}))()`),
    Boolean,
    "Quick Add task did not persist through the actual window",
  );

  const regressions = await windows.main.evaluate(`(async () => {
    const calendar = await import('/src/features/calendar/service.ts');
    const model = await import('/src/features/calendar/model.ts');
    const ical = await import('/src/features/ical-sync/service.ts');
    const current = new Date();
    const range = await calendar.loadCalendarRange(model.monthRange(current.getFullYear(), current.getMonth()));
    const status = await ical.getIcalConnectionStatus();
    return {
      calendarLoaded: Array.isArray(range.occurrences) && Array.isArray(range.assignments),
      icalStatusLoaded: typeof status.connected === 'boolean' && typeof status.status === 'string',
    };
  })()`);
  assert.deepEqual(regressions, { calendarLoaded: true, icalStatusLoaded: true });

  console.log(JSON.stringify({
    mainPipRecommendationMatch: true,
    focus: ["start", "pause", "resume", "complete", "cancel"],
    hardLockReason: true,
    rawScoreHidden: true,
    lastSafeStartRendered: true,
    prepareNextEvent: true,
    quickAddActualWindow: true,
    calendarRangeActualApp: true,
    icalStatusActualApp: true,
    screenshots: ["qa/.tmp/decision-main.png", "qa/.tmp/decision-pip.png"],
  }, null, 2));
} finally {
  let cleanupError;
  try { await cleanup(); } catch (error) { cleanupError = error; }
  for (const [, session] of entries) session.close();
  if (cleanupError) throw cleanupError;
}
