import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const CDP_URL = "http://127.0.0.1:9222/json";
const QA_EVENT_ID = "qa:calendar:v01:quick-add-event";
const QA_EVENT_TITLE = "Calendar QA 일정";
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

const targets = await (await fetch(CDP_URL)).json();
const entries = await Promise.all(targets.map(async (target) => {
  const session = new CdpSession(target);
  return [await session.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label"), session];
}));
const windows = Object.fromEntries(entries);
assert.deepEqual(Object.keys(windows).sort(), ["calendar", "main", "pet", "pip", "quick-add"]);

let eventCreated = false;
try {
  const focusBefore = await windows.main.evaluate(`(async () => {
    const repositories = await import('/src/data/repositories/index.ts');
    return repositories.focusSessionRepository.getActive();
  })()`);
  assert.deepEqual(await windows.calendar.evaluate("({ width: innerWidth, height: innerHeight })"), { width: 311, height: 433 });

  const actualRange = await windows.calendar.evaluate(`(async () => {
    const service = await import('/src/features/calendar/service.ts');
    const model = await import('/src/features/calendar/model.ts');
    const repositories = await import('/src/data/repositories/index.ts');
    const september = model.monthRange(2026, 8);
    const data = await service.loadCalendarRange(september);
    const assignments = await repositories.assignmentRepository.listOpen();
    const provider = assignments.find((item) => item.sourceId === 'integration:ical:canvas-dankook');
    const providerDueKey = provider ? model.assignmentDateKey(provider) : null;
    let providerInDueMonth = false;
    if (providerDueKey) {
      const [year, month] = providerDueKey.split('-').map(Number);
      const dueMonth = await service.loadCalendarRange(model.monthRange(year, month - 1));
      providerInDueMonth = dueMonth.assignments.some((item) => item.id === provider.id);
    }
    return {
      recurringCount: data.occurrences.filter((item) => item.origin === 'recurring').length,
      providerAssignmentExists: Boolean(provider),
      providerInDueMonth,
      providerExternalIdLeaked: provider?.externalId ? document.body.innerText.includes(provider.externalId) : false,
    };
  })()`);
  assert.ok(actualRange.recurringCount > 0, "actual Semester rules must generate September occurrences through the range API");
  assert.equal(actualRange.providerAssignmentExists, true, "real iCal Assignment must remain available to Calendar");
  assert.equal(actualRange.providerInDueMonth, true, "real iCal Assignment must appear in its Calendar month range");
  assert.equal(actualRange.providerExternalIdLeaked, false, "provider identity must not render in Calendar UI");

  await windows.calendar.evaluate(`(async () => {
    const repositories = await import('/src/data/repositories/index.ts');
    const data = await import('/src/data/studyData.ts');
    const source = await repositories.sourceRepository.getOrCreateManual();
    await repositories.eventRepository.remove(${JSON.stringify(QA_EVENT_ID)});
    await repositories.eventRepository.save({
      id: ${JSON.stringify(QA_EVENT_ID)}, sourceId: source.id, courseId: null, externalId: null,
      eventType: 'personal', title: ${JSON.stringify(QA_EVENT_TITLE)},
      startAt: '2026-09-13T15:01:00.000Z', endAt: null, location: null,
      isFixed: true, notes: null,
    });
    await data.notifyStudyDataChanged();
  })()`);
  eventCreated = true;
  await wait(500);

  await windows.calendar.evaluate(`(async () => {
    const currentYear = Number(document.querySelector('.calendar-header > span')?.textContent);
    const currentMonth = Number(document.querySelector('.calendar-header h1')?.textContent?.replace('월', ''));
    const distance = (2026 - currentYear) * 12 + 9 - currentMonth;
    const selector = distance >= 0 ? '[aria-label="다음 달"]' : '[aria-label="이전 달"]';
    for (let index = 0; index < Math.abs(distance); index += 1) {
      document.querySelector(selector)?.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const day = [...document.querySelectorAll('.calendar-date')]
      .find((item) => item.getAttribute('aria-label')?.startsWith('2026-09-14'));
    day?.click();
  })()`);
  await wait(150);
  const rendered = await windows.calendar.evaluate(`({
    heading: document.querySelector('#calendar-upcoming-heading')?.textContent,
    titles: [...document.querySelectorAll('.calendar-upcoming li strong')].map((item) => item.textContent),
    occurrenceRows: document.querySelectorAll('.calendar-upcoming li[data-kind="occurrence"]').length,
    markedDays: document.querySelectorAll('.calendar-date--has-items').length,
  })`);
  assert.match(rendered.heading, /^9월 14일 일정/);
  assert.ok(rendered.titles.includes(QA_EVENT_TITLE), "one-off Event must render after the data-change event");
  assert.ok(rendered.titles.includes("고급프로그래밍"), "actual Semester occurrence must render for the selected date");
  assert.ok(rendered.occurrenceRows >= 3);
  assert.ok(rendered.markedDays > 0);

  await mkdir("qa/.tmp", { recursive: true });
  const { data } = await windows.calendar.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: 311, height: 433, scale: 1 },
  });
  await writeFile("qa/.tmp/calendar-v01.png", Buffer.from(data, "base64"));

  const assignmentRendered = await windows.calendar.evaluate(`(async () => {
    const repositories = await import('/src/data/repositories/index.ts');
    const model = await import('/src/features/calendar/model.ts');
    const assignments = await repositories.assignmentRepository.listOpen();
    const provider = assignments.find((item) => item.sourceId === 'integration:ical:canvas-dankook');
    const dueKey = provider ? model.assignmentDateKey(provider) : null;
    if (!provider || !dueKey) return false;
    const [targetYear, targetMonth] = dueKey.split('-').map(Number);
    const readView = () => ({
      year: Number(document.querySelector('.calendar-header > span')?.textContent),
      month: Number(document.querySelector('.calendar-header h1')?.textContent?.replace('월', '')),
    });
    let view = readView();
    let distance = (targetYear - view.year) * 12 + targetMonth - view.month;
    const selector = distance >= 0 ? '[aria-label="다음 달"]' : '[aria-label="이전 달"]';
    for (let index = 0; index < Math.abs(distance); index += 1) {
      document.querySelector(selector)?.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const day = [...document.querySelectorAll('.calendar-date')]
      .find((item) => item.getAttribute('aria-label')?.startsWith(dueKey));
    return Boolean(day?.getAttribute('aria-label')?.includes(provider.title));
  })()`);
  assert.equal(assignmentRendered, true, "normalized real iCal Assignment must render on its due date");

  const sixRowLayout = await windows.calendar.evaluate(`(async () => {
    const currentYear = Number(document.querySelector('.calendar-header > span')?.textContent);
    const currentMonth = Number(document.querySelector('.calendar-header h1')?.textContent?.replace('월', ''));
    const distance = (2026 - currentYear) * 12 + 8 - currentMonth;
    const selector = distance >= 0 ? '[aria-label="다음 달"]' : '[aria-label="이전 달"]';
    for (let index = 0; index < Math.abs(distance); index += 1) {
      document.querySelector(selector)?.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const grid = document.querySelector('.calendar-dates');
    const lastDay = [...document.querySelectorAll('.calendar-date')]
      .find((item) => item.getAttribute('aria-label')?.startsWith('2026-08-31'));
    const divider = document.querySelector('.calendar-upcoming');
    return {
      isSixRows: grid?.classList.contains('calendar-dates--6-rows'),
      hasDividerGap: Boolean(lastDay && divider && lastDay.getBoundingClientRect().bottom <= divider.getBoundingClientRect().top - 8),
    };
  })()`);
  assert.deepEqual(sixRowLayout, { isSixRows: true, hasDividerGap: true });

  const focusAfter = await windows.main.evaluate(`(async () => {
    const repositories = await import('/src/data/repositories/index.ts');
    return repositories.focusSessionRepository.getActive();
  })()`);
  assert.deepEqual(focusAfter, focusBefore, "Calendar QA must not mutate FocusSession state");
  console.log(JSON.stringify({
    windows: Object.keys(windows).sort(),
    size: { width: 311, height: 433 },
    recurringRange: true,
    quickAddEventRefresh: true,
    realIcalAssignment: true,
    realIcalAssignmentRendered: true,
    providerRawDataHidden: true,
    selectedDateAgenda: true,
    sixRowMonth: true,
    focusSessionUnchanged: true,
    screenshot: "qa/.tmp/calendar-v01.png",
  }, null, 2));
} finally {
  if (eventCreated && windows.calendar) {
    try {
      await windows.calendar.evaluate(`(async () => {
        const repositories = await import('/src/data/repositories/index.ts');
        const data = await import('/src/data/studyData.ts');
        await repositories.eventRepository.remove(${JSON.stringify(QA_EVENT_ID)});
        await data.notifyStudyDataChanged();
      })()`);
    } catch {}
  }
  for (const [, session] of entries) session.close();
}
