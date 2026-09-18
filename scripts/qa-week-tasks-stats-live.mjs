import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const CDP_URL = "http://127.0.0.1:9222/json";
const PREFIX = "qa:milestone:";
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

async function poll(read, predicate, message, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() <= deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await wait(120);
  }
  throw new Error(message);
}

async function replaceEditorInput(session, index, value) {
  await session.evaluate(`(() => {
    const input = document.querySelectorAll('.task-editor-fields input')[${index}];
    input?.focus();
    input?.select();
  })()`);
  await session.send("Input.insertText", { text: value });
  await wait(80);
}

const targets = await (await fetch(CDP_URL)).json();
const entries = await Promise.all(targets.map(async (target) => {
  const session = new CdpSession(target);
  return [await session.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label"), session];
}));
const windows = Object.fromEntries(entries);
assert.deepEqual(Object.keys(windows).sort(), ["calendar", "main", "pet", "pip", "quick-add"]);

const snapshot = await windows.main.evaluate(`(async () => {
  const db = await (await import('/src/data/db/client.ts')).getDatabase();
  const active = (await db.select("SELECT * FROM focus_sessions WHERE status IN ('running','paused') LIMIT 1"))[0] ?? null;
  return {
    active,
    activeTask: active?.task_id
      ? (await db.select("SELECT status, completed_at, updated_at FROM study_tasks WHERE id=?1", [active.task_id]))[0] ?? null
      : null,
    activeIntervals: active
      ? await db.select("SELECT * FROM focus_intervals WHERE session_id=?1 ORDER BY started_at, id", [active.id])
      : [],
    decision: (await db.select("SELECT * FROM app_meta WHERE key='decision_engine_current_candidate_v1'"))[0] ?? null,
  };
})()`);

async function cleanup() {
  await windows.main.evaluate(`(async () => {
    const db = await (await import('/src/data/db/client.ts')).getDatabase();
    await db.execute("DELETE FROM focus_sessions WHERE id LIKE 'qa:milestone:%' OR task_id IN (SELECT id FROM study_tasks WHERE id LIKE 'qa:milestone:%' OR assignment_id LIKE 'qa:milestone:%' OR (title='QA 가상 과제' AND created_at >= '2026-09-13T23:00:00.000Z'))");
    await db.execute("DELETE FROM task_steps WHERE task_id LIKE 'qa:milestone:%'");
    await db.execute("DELETE FROM study_tasks WHERE id LIKE 'qa:milestone:%' OR assignment_id LIKE 'qa:milestone:%' OR (title='QA 가상 과제' AND created_at >= '2026-09-13T23:00:00.000Z')");
    await db.execute("DELETE FROM assignments WHERE id LIKE 'qa:milestone:%'");
    await db.execute("DELETE FROM events WHERE id LIKE 'qa:milestone:%'");
    const active = ${JSON.stringify(snapshot.active)};
    if (active) {
      await db.execute(
        "UPDATE focus_sessions SET task_id=?1, started_at=?2, ended_at=?3, planned_minutes=?4, elapsed_seconds=?5, status=?6, last_resumed_at=?7, pause_count=?8, created_at=?9, updated_at=?10 WHERE id=?11",
        [active.task_id, active.started_at, active.ended_at, active.planned_minutes, active.elapsed_seconds, active.status, active.last_resumed_at, active.pause_count, active.created_at, active.updated_at, active.id],
      );
      await db.execute("DELETE FROM focus_intervals WHERE session_id=?1", [active.id]);
      for (const interval of ${JSON.stringify(snapshot.activeIntervals)}) {
        await db.execute(
          "INSERT INTO focus_intervals (id, session_id, started_at, ended_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
          [interval.id, interval.session_id, interval.started_at, interval.ended_at, interval.created_at],
        );
      }
      const activeTask = ${JSON.stringify(snapshot.activeTask)};
      if (active.task_id && activeTask) {
        await db.execute(
          "UPDATE study_tasks SET status=?1, completed_at=?2, updated_at=?3 WHERE id=?4",
          [activeTask.status, activeTask.completed_at, activeTask.updated_at, active.task_id],
        );
      }
    }
    const decision = ${JSON.stringify(snapshot.decision)};
    if (decision) {
      await db.execute(
        "INSERT INTO app_meta (key,value,updated_at) VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        [decision.key, decision.value, decision.updated_at],
      );
    } else {
      await db.execute("DELETE FROM app_meta WHERE key='decision_engine_current_candidate_v1'");
    }
    await (await import('/src/data/studyData.ts')).notifyStudyDataChanged();
  })()`);
  const restored = await windows.main.evaluate(`(async () => {
    const db = await (await import('/src/data/db/client.ts')).getDatabase();
    const active = (await db.select("SELECT * FROM focus_sessions WHERE status IN ('running','paused') LIMIT 1"))[0] ?? null;
    return {
      active,
      activeTask: active?.task_id
        ? (await db.select("SELECT status, completed_at, updated_at FROM study_tasks WHERE id=?1", [active.task_id]))[0] ?? null
        : null,
      activeIntervals: active
        ? await db.select("SELECT * FROM focus_intervals WHERE session_id=?1 ORDER BY started_at, id", [active.id])
        : [],
    };
  })()`);
  assert.deepEqual(restored.active, snapshot.active, "Milestone QA must restore the original active FocusSession");
  assert.deepEqual(restored.activeTask, snapshot.activeTask, "Milestone QA must restore the active StudyTask state");
  assert.deepEqual(restored.activeIntervals, snapshot.activeIntervals, "Milestone QA must restore focus intervals exactly");
}

try {
  await cleanup();
  const seeded = await windows.main.evaluate(`(async () => {
    const db = await (await import('/src/data/db/client.ts')).getDatabase();
    const repositories = await import('/src/data/repositories/index.ts');
    const calendar = await import('/src/features/calendar/model.ts');
    const week = await import('/src/features/week/model.ts');
    const source = await repositories.sourceRepository.getOrCreateManual();
    const now = new Date();
    const range = week.getLocalWeekRange(now);
    const today = calendar.localDateKey(now);
    const tomorrowDate = new Date(now); tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = calendar.localDateKey(tomorrowDate);
    const laterDate = new Date(range.end); laterDate.setDate(laterDate.getDate() + 2);
    const later = calendar.localDateKey(laterDate);
    const endOf = (key) => {
      const [year, month, day] = key.split('-').map(Number);
      return new Date(new Date(year, month - 1, day + 1).getTime() - 1).toISOString();
    };
    if (${JSON.stringify(snapshot.active)}?.id) {
      await db.execute("UPDATE focus_sessions SET status='cancelled', ended_at=?1, updated_at=?1 WHERE id=?2", [now.toISOString(), ${JSON.stringify(snapshot.active?.id ?? null)}]);
    }
    await repositories.assignmentRepository.save({
      id: 'qa:milestone:assignment:linked', sourceId: source.id, courseId: null, externalId: null,
      title: 'QA 연결 원본 과제', description: null, dueAt: null, dueOn: tomorrow,
      dueTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone, points: null, submissionType: null,
      status: 'open', submittedAt: null, gradedAt: null,
    });
    await repositories.assignmentRepository.save({
      id: 'qa:milestone:assignment:virtual', sourceId: source.id, courseId: null, externalId: null,
      title: 'QA 가상 과제', description: 'lazy create 검증', dueAt: null, dueOn: tomorrow,
      dueTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone, points: null, submissionType: null,
      status: 'open', submittedAt: null, gradedAt: null,
    });
    const task = (id, title, dueAt, status='todo') => repositories.studyTaskRepository.save({
      id, sourceId: source.id, courseId: null, assignmentId: null, title, notes: null,
      estimatedMinutes: 25, priority: 70, status, dueAt, plannedStartAt: null,
      completedAt: status === 'done' ? now.toISOString() : null,
    });
    await repositories.studyTaskRepository.save({
      id: 'qa:milestone:task:linked', sourceId: source.id, courseId: null,
      assignmentId: 'qa:milestone:assignment:linked', title: 'QA 연결 실행 과제', notes: null,
      estimatedMinutes: 30, priority: 90, status: 'todo', dueAt: endOf(tomorrow), plannedStartAt: null, completedAt: null,
    });
    await task('qa:milestone:task:overdue', 'QA 기한 지난 할 일', new Date(range.start.getTime() - 1).toISOString());
    await task('qa:milestone:task:today', 'QA 오늘 할 일', endOf(today));
    await task('qa:milestone:task:later', 'QA 나중 할 일', endOf(later));
    await task('qa:milestone:task:none', 'QA 기한 없는 할 일', null);
    await task('qa:milestone:task:done', 'QA 완료한 할 일', endOf(today), 'done');
    await repositories.eventRepository.save({
      id: 'qa:milestone:event', sourceId: source.id, courseId: null, externalId: null,
      eventType: 'personal', title: 'QA 이번 주 일정', startAt: new Date(now.getTime() + 20 * 60 * 1000).toISOString(),
      endAt: null, location: 'QA', isFixed: true, notes: null,
    });
    const focusEnd = new Date(now.getTime() - 2 * 60 * 1000);
    const focusStart = new Date(focusEnd.getTime() - 12 * 60 * 1000);
    await db.execute(
      "INSERT INTO focus_sessions (id,task_id,started_at,ended_at,planned_minutes,elapsed_seconds,status,last_resumed_at,pause_count,created_at,updated_at) VALUES (?1,NULL,?2,?3,15,720,'completed',?2,0,?2,?3)",
      ['qa:milestone:focus:history', focusStart.toISOString(), focusEnd.toISOString()],
    );
    await db.execute(
      "INSERT INTO focus_intervals (id,session_id,started_at,ended_at,created_at) VALUES (?1,?2,?3,?4,?3)",
      ['qa:milestone:interval:history', 'qa:milestone:focus:history', focusStart.toISOString(), focusEnd.toISOString()],
    );
    await (await import('/src/data/studyData.ts')).notifyStudyDataChanged();
    return { today, tomorrow };
  })()`);

  await windows.main.evaluate(`[...document.querySelectorAll('.main-tab')].find((node) => node.textContent === '주간')?.click()`);
  const weekUi = await poll(
    () => windows.main.evaluate(`({
      dayCount: document.querySelectorAll('.week-day').length,
      text: document.querySelector('.week-surface')?.innerText ?? '',
      todayCount: document.querySelectorAll('.week-day--today').length,
      stats: [...document.querySelectorAll('.focus-summary dd')].map((node) => node.textContent),
    })`),
    (value) => value.dayCount === 7 && value.text.includes('QA 이번 주 일정'),
    "Week surface did not render the seven-day actual data view",
  );
  assert.equal(weekUi.todayCount, 1);
  assert.match(weekUi.text, /QA 연결 실행 과제/);
  assert.match(weekUi.text, /QA 가상 과제/);
  assert.doesNotMatch(weekUi.text, /QA 연결 원본 과제/, "linked Assignment must not duplicate its StudyTask");
  assert.equal(weekUi.stats.length, 3);
  assert.match(weekUi.stats[0], /분|시간/, "today focus duration must render from persisted intervals");

  const navigation = await windows.main.evaluate(`(async () => {
    const label = () => document.querySelector('.week-header > div > span')?.textContent;
    const before = label();
    document.querySelector('[aria-label="다음 주"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const next = label();
    [...document.querySelectorAll('.week-navigation button')].find((node) => node.textContent === '오늘')?.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { before, next, back: label() };
  })()`);
  assert.notEqual(navigation.before, navigation.next);
  assert.equal(navigation.before, navigation.back);

  await mkdir("qa/.tmp", { recursive: true });
  let capture = await windows.main.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile("qa/.tmp/week-v01.png", Buffer.from(capture.data, "base64"));

  await windows.main.evaluate(`[...document.querySelectorAll('.main-tab')].find((node) => node.textContent === '과제')?.click()`);
  const tasksUi = await poll(
    () => windows.main.evaluate(`document.querySelector('.tasks-surface')?.innerText ?? ''`),
    (text) => text.includes("QA 가상 과제") && text.includes("QA 완료한 할 일"),
    "Tasks surface did not render the merged list",
  );
  for (const label of ["기한 지남", "오늘", "이번 주", "나중", "기한 없음", "완료"]) assert.match(tasksUi, new RegExp(label));
  assert.doesNotMatch(tasksUi, /QA 연결 원본 과제/, "virtual linked Assignment must stay suppressed in Tasks");

  await windows.main.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.task-row')].find((node) => node.textContent?.includes('QA 오늘 할 일'));
    row?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
  })()`);
  await replaceEditorInput(windows.main, 0, "82");
  await replaceEditorInput(windows.main, 1, "47");
  const editorInteraction = await windows.main.evaluate(`({
    heading: document.querySelector('.task-editor h2')?.textContent,
    values: [...document.querySelectorAll('.task-editor-fields input')].map((input) => input.value),
  })`);
  assert.equal(editorInteraction.heading, "QA 오늘 할 일");
  assert.deepEqual(editorInteraction.values, ["82", "47", seeded.today]);
  const directUpdate = await windows.main.evaluate(`(async () => {
    const service = await import('/src/features/tasks/service.ts');
    const repositories = await import('/src/data/repositories/index.ts');
    const data = await service.loadTasksSurface();
    const item = data.items.find((entry) => entry.id === 'task:qa:milestone:task:today');
    await service.updateTaskItem(item, { priority: 82, estimatedMinutes: 47, deadlineDate: ${JSON.stringify(seeded.tomorrow)} });
    await (await import('/src/data/studyData.ts')).notifyStudyDataChanged();
    return repositories.studyTaskRepository.get('qa:milestone:task:today');
  })()`);
  assert.equal(directUpdate.priority, 82);
  assert.equal(directUpdate.estimatedMinutes, 47);
  assert.equal(new Date(directUpdate.dueAt).getDate(), Number(seeded.tomorrow.slice(-2)));

  await windows.main.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.task-row')].find((node) => node.textContent?.includes('QA 가상 과제'));
    row?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const service = await import('/src/features/tasks/service.ts');
    const data = await service.loadTasksSurface();
    const item = data.items.find((entry) => entry.id === 'assignment:qa:milestone:assignment:virtual');
    await service.startTaskItem(item);
    await (await import('/src/data/studyData.ts')).notifyStudyDataChanged();
  })()`);
  const focusStarted = await poll(
    () => windows.main.evaluate(`(async () => {
      const db = await (await import('/src/data/db/client.ts')).getDatabase();
      return {
        active: (await db.select("SELECT id,task_id,status FROM focus_sessions WHERE status IN ('running','paused')")),
        linked: (await db.select("SELECT id,assignment_id FROM study_tasks WHERE assignment_id='qa:milestone:assignment:virtual' AND status IN ('todo','doing','paused')")),
        openIntervals: (await db.select("SELECT i.id FROM focus_intervals i JOIN focus_sessions f ON f.id=i.session_id WHERE i.ended_at IS NULL AND f.task_id IN (SELECT id FROM study_tasks WHERE assignment_id='qa:milestone:assignment:virtual')")),
      };
    })()`),
    (value) => value.active.length === 1 && value.linked.length === 1 && value.openIntervals.length === 1,
    "Assignment Start did not lazily create/reuse one StudyTask and FocusSession",
  );
  assert.equal(focusStarted.active[0].task_id, focusStarted.linked[0].id);

  const secondStartBlocked = await windows.main.evaluate(`(async () => {
    const service = await import('/src/features/tasks/service.ts');
    const data = await service.loadTasksSurface();
    const other = data.items.find((item) => item.id === 'task:qa:milestone:task:none');
    try { await service.startTaskItem(other); return { blocked: false, message: null, ids: data.items.map((item) => item.id) }; }
    catch (error) { return { blocked: true, message: String(error), ids: data.items.map((item) => item.id) }; }
  })()`);
  assert.equal(secondStartBlocked.blocked, true, `a second active FocusSession must be rejected: ${secondStartBlocked.message}`);
  assert.match(secondStartBlocked.message, /active|활성|진행 중/i);

  await windows.pip.evaluate("document.querySelector('.pip-v02__session')?.click()");
  await poll(
    () => windows.main.evaluate(`(async () => (await (await import('/src/data/repositories/index.ts')).focusSessionRepository.getActive())?.status)()`),
    (status) => status === "paused",
    "actual PIP pause did not close the running focus interval",
  );
  const closedInterval = await windows.main.evaluate(`(async () => {
    const db = await (await import('/src/data/db/client.ts')).getDatabase();
    return (await db.select("SELECT i.ended_at FROM focus_intervals i JOIN focus_sessions f ON f.id=i.session_id JOIN study_tasks t ON t.id=f.task_id WHERE t.title='QA 가상 과제' ORDER BY i.created_at DESC LIMIT 1"))[0]?.ended_at ?? null;
  })()`);
  assert.ok(closedInterval, "pause must close the active interval so paused time is excluded");

  const outcomes = await windows.main.evaluate(`(async () => {
    const service = await import('/src/features/tasks/service.ts');
    const repositories = await import('/src/data/repositories/index.ts');
    const data = await service.loadTasksSurface();
    await service.setTaskItemOutcome(data.items.find((item) => item.id === 'task:qa:milestone:task:later'), 'complete');
    await service.setTaskItemOutcome(data.items.find((item) => item.id === 'task:qa:milestone:task:none'), 'cancel');
    await (await import('/src/data/studyData.ts')).notifyStudyDataChanged();
    return {
      completed: (await repositories.studyTaskRepository.get('qa:milestone:task:later'))?.status,
      cancelled: (await repositories.studyTaskRepository.get('qa:milestone:task:none'))?.status,
    };
  })()`);
  assert.deepEqual(outcomes, { completed: "done", cancelled: "cancelled" });

  capture = await windows.main.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile("qa/.tmp/tasks-v01.png", Buffer.from(capture.data, "base64"));

  console.log(JSON.stringify({
    windows: Object.keys(windows).sort(),
    week: { mondayThroughSunday: true, navigation: true, actualData: true, linkedDedup: true },
    tasks: { groups: true, edit: true, completeAndCancel: true, assignmentLazyStart: true, secondSessionBlocked: true },
    focusStats: { visible: true, runningInterval: true, pauseExcluded: true },
    screenshots: ["qa/.tmp/week-v01.png", "qa/.tmp/tasks-v01.png"],
  }, null, 2));
} finally {
  let cleanupError;
  try { await cleanup(); } catch (error) { cleanupError = error; }
  Object.values(windows).forEach((session) => session.close());
  if (cleanupError) throw cleanupError;
}
