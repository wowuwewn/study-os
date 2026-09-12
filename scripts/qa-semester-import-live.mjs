import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const CDP_URL = "http://127.0.0.1:9222/json";
const schedulePath = resolve(process.argv[2] ?? "semester.local.json");
const schedule = JSON.parse(await readFile(schedulePath, "utf8"));
const expectedCourseCount = schedule.courses.length;
const expectedRuleCount = schedule.courses.reduce((total, course) => total + course.meetings.length, 0);
const actualNow = new Date();
const actualDate = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(actualNow);
const expectedTodayHeading = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
}).format(actualNow);
const expectedRecurringToday = actualDate >= schedule.semester.startsOn && actualDate <= schedule.semester.endsOn
  ? schedule.courses.flatMap((course) => course.meetings).filter((meeting) => meeting.weekday === actualNow.getDay()).length
  : 0;

class CdpSession {
  constructor(target) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.ready = new Promise((resolveReady, reject) => {
      this.socket.addEventListener("open", resolveReady, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
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
    const response = new Promise((resolveResponse, reject) => this.pending.set(id, { resolve: resolveResponse, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

const targets = await (await fetch(CDP_URL)).json();
const sessions = [];
let main;
for (const target of targets) {
  const session = new CdpSession(target);
  sessions.push(session);
  const label = await session.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label");
  if (label === "main") main = session;
}
assert.ok(main, "the running Tauri application must expose its main window on CDP port 9222");

const expression = `(async () => {
  const schedule = ${JSON.stringify(schedule)};
  const service = await import('/src/features/schedule/service.ts');
  const repositories = await import('/src/data/repositories/index.ts');
  const studyData = await import('/src/data/studyData.ts');
  const beforeEvents = await repositories.eventRepository.listBetween('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
  const first = await service.importLocalSemesterSchedule(schedule);
  const firstIds = {
    semester: first.semester.id,
    courses: first.courses.map((course) => course.id),
    rules: first.rules.map((rule) => rule.id),
  };
  const second = await service.importLocalSemesterSchedule(schedule);
  const semesters = await repositories.semesterRepository.list();
  const rules = await repositories.recurringScheduleRepository.listForSemester(second.semester.id);
  const courses = await repositories.courseRepository.list();
  const afterEvents = await repositories.eventRepository.listBetween('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
  const today = await service.listTodaySchedule();
  const monday = await service.listScheduleOccurrencesBetween('2026-09-13T15:00:00.000Z', '2026-09-14T15:00:00.000Z');
  await studyData.notifyStudyDataChanged();
  return {
    firstIds,
    secondIds: {
      semester: second.semester.id,
      courses: second.courses.map((course) => course.id),
      rules: second.rules.map((rule) => rule.id),
    },
    semester: semesters.find((semester) => semester.id === second.semester.id),
    importedCourseCount: second.courses.length,
    ruleCourseCount: new Set(rules.map((rule) => rule.courseId)).size,
    totalCourseCount: courses.length,
    ruleCount: rules.length,
    eventCountBefore: beforeEvents.length,
    eventCountAfter: afterEvents.length,
    today: today.map(({ title, startAt, endAt, origin }) => ({ title, startAt, endAt, origin })),
    monday: monday.map(({ title, startAt, endAt, location, origin }) => ({ title, startAt, endAt, location, origin })),
  };
})()`;

try {
  const result = await main.evaluate(expression);
  assert.equal(result.importedCourseCount, expectedCourseCount, "import result course count must match the local document");
  assert.equal(new Set(result.secondIds.courses).size, expectedCourseCount, "import must resolve exactly the document's courses");
  assert.equal(result.ruleCourseCount, expectedCourseCount, "weekly rules must reference exactly the imported courses");
  assert.equal(result.ruleCount, expectedRuleCount, "database must contain exactly the imported weekly rules");
  assert.deepEqual(result.secondIds, result.firstIds, "re-import must preserve semester, course, and rule IDs");
  assert.equal(result.eventCountAfter, result.eventCountBefore, "recurring import must not create Event rows");
  assert.equal(result.semester.startsOn, schedule.semester.startsOn);
  assert.equal(result.semester.endsOn, schedule.semester.endsOn);
  assert.equal(result.semester.timezone, schedule.semester.timezone);
  assert.equal(
    result.today.filter((occurrence) => occurrence.origin === "recurring").length,
    expectedRecurringToday,
    "Today must use the actual system-local date",
  );
  assert.deepEqual(result.monday, [
    { title: "고급프로그래밍", startAt: "2026-09-14T01:00:00.000Z", endAt: "2026-09-14T02:30:00.000Z", location: "소프트517", origin: "recurring" },
    { title: "멀티미디어신호처리", startAt: "2026-09-14T05:00:00.000Z", endAt: "2026-09-14T06:30:00.000Z", location: "소프트516", origin: "recurring" },
  ]);
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  const mainText = await main.evaluate("document.body.innerText");
  assert.match(mainText, new RegExp(expectedTodayHeading));
  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const session of sessions) session.close();
}
