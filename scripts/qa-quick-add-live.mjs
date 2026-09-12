import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const CDP_URL = "http://127.0.0.1:9222/json";

class CdpSession {
  constructor(target) {
    this.target = target;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
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
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function setInput(session, value) {
  await session.evaluate(`(() => {
    const input = document.querySelector('.quick-add-form input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  })()`);
  await wait(200);
  await session.evaluate("window.scrollTo(0, 0)");
}

async function press(session, key, code = key) {
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
}

function pressGlobalShortcut() {
  const command = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class QuickAddKeys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
[QuickAddKeys]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
[QuickAddKeys]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)
[QuickAddKeys]::keybd_event(0x20, 0, 0, [UIntPtr]::Zero)
[QuickAddKeys]::keybd_event(0x20, 0, 2, [UIntPtr]::Zero)
[QuickAddKeys]::keybd_event(0x10, 0, 2, [UIntPtr]::Zero)
[QuickAddKeys]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
`;
  execFileSync("powershell.exe", ["-NoProfile", "-Command", command]);
}

async function screenshot(session, path) {
  await session.evaluate(`(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    await invoke('plugin:window|hide', { label: 'quick-add' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    await invoke('plugin:window|show', { label: 'quick-add' });
    await invoke('plugin:window|set_focus', { label: 'quick-add' });
    window.scrollTo(0, 0);
  })()`);
  await session.evaluate(`new Promise((resolve) => {
    const mark = document.querySelector('.quick-add-mark');
    mark.style.transform = 'translateZ(0)';
    mark.style.opacity = '0.999';
    requestAnimationFrame(() => {
      mark.style.opacity = '1';
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  })`);
  await wait(250);
  const { data } = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: 810, height: 126, scale: 2 },
  });
  await writeFile(path, Buffer.from(data, "base64"));
}

async function warmScreenshotSurface(session) {
  // WebView2 can return an incomplete first frame after a hide/show cycle.
  await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: 810, height: 126, scale: 2 },
  });
}

async function queryData(session) {
  return session.evaluate(`(async () => {
    const repositories = await import('/src/data/repositories/index.ts');
    const [tasks, events, focus] = await Promise.all([
      repositories.studyTaskRepository.listOpen(),
      repositories.eventRepository.listBetween('2026-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
      repositories.focusSessionRepository.getActive(),
    ]);
    return {
      tasks: tasks.map(({ id, title, estimatedMinutes }) => ({ id, title, estimatedMinutes })),
      events: events.map(({ id, title, startAt }) => ({ id, title, startAt })),
      focus: focus ? { id: focus.id, taskId: focus.taskId, status: focus.status, elapsedSeconds: focus.elapsedSeconds } : null,
    };
  })()`);
}

const targets = await (await fetch(CDP_URL)).json();
const sessions = await Promise.all(targets.map(async (target) => {
  const session = new CdpSession(target);
  const label = await session.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label");
  return [label, session];
}));
const windows = Object.fromEntries(sessions);
assert.deepEqual(Object.keys(windows).sort(), ["main", "pet", "pip", "quick-add"]);
const quick = windows["quick-add"];
const main = windows.main;
const before = await queryData(main);

await mkdir("qa", { recursive: true });
pressGlobalShortcut();
await wait(500);
assert.equal(await quick.evaluate("document.hasFocus() && document.activeElement?.matches('.quick-add-form input')"), true);
await screenshot(quick, "qa/quick-add-v01-empty.png");

await press(quick, "Escape", "Escape");
await wait(250);
pressGlobalShortcut();
await wait(300);
await setInput(quick, "Java 복습 40분");
assert.match(await quick.evaluate("document.querySelector('.quick-add-preview')?.innerText"), /할 일.*예상 40분/s);
await warmScreenshotSurface(quick);
await screenshot(quick, "qa/quick-add-v01-parsed-task.png");
await press(quick, "Escape", "Escape");
await wait(250);
assert.equal((await queryData(main)).tasks.length, before.tasks.length);

pressGlobalShortcut();
await wait(300);
assert.equal(await quick.evaluate("document.hasFocus()"), true);
await setInput(quick, "Java 복습 40분");
await press(quick, "Enter", "Enter");
await wait(900);
const afterTask = await queryData(main);
const savedTask = afterTask.tasks.find((task) => task.title === "Java 복습" && task.estimatedMinutes === 40);
if (!savedTask) {
  console.error(JSON.stringify({ afterTask, quickText: await quick.evaluate("document.body.innerText") }, null, 2));
}
assert.ok(savedTask, "StudyTask was not saved");

pressGlobalShortcut();
await wait(300);
await setInput(quick, "내일 3시 피부과");
assert.match(await quick.evaluate("document.querySelector('.quick-add-preview')?.innerText"), /일정.*15:00/s);
await warmScreenshotSurface(quick);
await screenshot(quick, "qa/quick-add-v01-parsed-event.png");
await press(quick, "Enter", "Enter");
await wait(900);
const afterEvent = await queryData(main);
const savedEvent = afterEvent.events.find((event) => event.title === "피부과");
assert.ok(savedEvent, "Event was not saved");

pressGlobalShortcut();
await wait(300);
await press(quick, "Enter", "Enter");
await wait(250);
assert.match(await quick.evaluate("document.querySelector('[role=status]')?.innerText"), /입력/);
const afterInvalid = await queryData(main);
assert.equal(afterInvalid.tasks.length, afterTask.tasks.length);
assert.equal(afterInvalid.events.length, afterEvent.events.length);
await press(quick, "Escape", "Escape");

pressGlobalShortcut();
await wait(250);
await press(quick, "Escape", "Escape");
pressGlobalShortcut();
await wait(250);
const repeatedTargets = await (await fetch(CDP_URL)).json();
assert.equal(repeatedTargets.length, 4);
await press(quick, "Escape", "Escape");

const after = await queryData(main);
assert.deepEqual(after.focus, before.focus);

pressGlobalShortcut();
await wait(250);
await setInput(quick, "내일 3시 피부과");
await screenshot(quick, "qa/quick-add-v01-parsed-event.png");
await press(quick, "Escape", "Escape");

await main.evaluate(`(async () => {
  const repositories = await import('/src/data/repositories/index.ts');
  const studyData = await import('/src/data/studyData.ts');
  await repositories.studyTaskRepository.remove(${JSON.stringify(savedTask.id)});
  await repositories.eventRepository.remove(${JSON.stringify(savedEvent.id)});
  await studyData.notifyStudyDataChanged();
})()`);

for (const [, session] of sessions) session.close();
console.log(JSON.stringify({
  windows: Object.keys(windows).sort(),
  shortcutFocusedInput: true,
  taskSavedInDatabase: savedTask,
  eventSavedInDatabase: savedEvent,
  escapePreventedSave: true,
  invalidPreventedSave: true,
  noDuplicateWindow: true,
  focusSessionUnchanged: true,
  screenshots: [
    "qa/quick-add-v01-empty.png",
    "qa/quick-add-v01-parsed-task.png",
    "qa/quick-add-v01-parsed-event.png",
  ],
}, null, 2));
