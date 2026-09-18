import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const CDP_URL = "http://127.0.0.1:9222/json";
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

const visibility = () => windows.main.evaluate(`(async () => {
  const api = await import('/src/windowVisibility.ts');
  const current = await api.getAuxiliaryWindowVisibility();
  const tauri = await import('/node_modules/.vite/deps/@tauri-apps_api_window.js');
  return { main: await tauri.getCurrentWindow().isVisible(), ...current };
})()`);
const setVisible = (name, visible) => windows.main.evaluate(`(async () => {
  const api = await import('/src/windowVisibility.ts');
  await api.setAuxiliaryWindowVisibility(${JSON.stringify(name)}, ${visible});
})()`);

const command = process.argv[2];
if (command) {
  try {
    if (command === "snapshot-preferences") {
      const snapshot = await windows.main.evaluate(`({
        visibility: localStorage.getItem('study-os:auxiliary-visibility:v1'),
        pip: localStorage.getItem('study-os:pip-visible:v1'),
        calendar: localStorage.getItem('study-os:calendar-visible:v1'),
        mode: localStorage.getItem('study-os:pip-mode:v1')
      })`);
      console.log(Buffer.from(JSON.stringify(snapshot), "utf8").toString("base64"));
    } else if (command === "restore-preferences") {
      const encoded = process.argv[3];
      assert.ok(encoded, "restore-preferences requires a base64 snapshot");
      const snapshot = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      await windows.main.evaluate(`(async () => {
        const saved = ${JSON.stringify(snapshot)};
        for (const [key, value] of [
          ['study-os:auxiliary-visibility:v1', saved.visibility],
          ['study-os:pip-visible:v1', saved.pip],
          ['study-os:calendar-visible:v1', saved.calendar],
          ['study-os:pip-mode:v1', saved.mode],
        ]) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
        const legacy = saved.visibility ? JSON.parse(saved.visibility) : { pip: false, calendar: false };
        const pip = saved.pip === 'true' ? true : saved.pip === 'false' ? false : legacy.pip === true;
        const calendar = saved.calendar === 'true' ? true : saved.calendar === 'false' ? false : legacy.calendar === true;
        const api = await import('/src/windowVisibility.ts');
        await api.setAuxiliaryWindowVisibility('pip', pip);
        await api.setAuxiliaryWindowVisibility('calendar', calendar);
        for (const [key, value] of [
          ['study-os:auxiliary-visibility:v1', saved.visibility],
          ['study-os:pip-visible:v1', saved.pip],
          ['study-os:calendar-visible:v1', saved.calendar],
          ['study-os:pip-mode:v1', saved.mode],
        ]) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      })()`);
      console.log("Restored visibility preferences.");
    } else if (command === "prepare-first-launch") {
      await setVisible("pip", false);
      await setVisible("calendar", false);
      await windows.main.evaluate(`(() => {
        localStorage.removeItem('study-os:auxiliary-visibility:v1');
        localStorage.removeItem('study-os:pip-visible:v1');
        localStorage.removeItem('study-os:calendar-visible:v1');
        localStorage.removeItem('study-os:pip-mode:v1');
      })()`);
      console.log("Prepared absent visibility preferences; restart the app before asserting.");
    } else if (command === "set-visible") {
      await setVisible("pip", true);
      await setVisible("calendar", true);
      console.log("Stored PIP and Calendar as visible; restart the app before asserting.");
    } else if (command === "set-hidden") {
      await setVisible("pip", false);
      await setVisible("calendar", false);
      console.log("Stored PIP and Calendar as hidden; restart the app before asserting.");
    } else if (command === "assert-launch-hidden" || command === "assert-launch-visible") {
      await wait(500);
      const actual = await visibility();
      const expectedVisible = command === "assert-launch-visible";
      assert.deepEqual(actual, { main: true, pip: expectedVisible, calendar: expectedVisible });
      console.log(JSON.stringify({ command, actual }, null, 2));
    } else {
      throw new Error(`Unknown visibility QA command: ${command}`);
    }
  } finally {
    for (const [, session] of entries) session.close();
  }
}

if (!command) {
const savedPreference = await windows.main.evaluate(`({
  visibility: localStorage.getItem('study-os:auxiliary-visibility:v1'),
  pip: localStorage.getItem('study-os:pip-visible:v1'),
  calendar: localStorage.getItem('study-os:calendar-visible:v1'),
  mode: localStorage.getItem('study-os:pip-mode:v1')
})`);

try {
  const focusBefore = await windows.main.evaluate(`(async () => {
    const repositories = await import('/src/data/repositories/index.ts');
    const active = await repositories.focusSessionRepository.getActive();
    return active && { id: active.id, taskId: active.taskId, status: active.status };
  })()`);

  await setVisible("pip", false);
  await setVisible("calendar", false);
  await wait(250);
  assert.deepEqual(await visibility(), { main: true, pip: false, calendar: false });

  await windows.main.evaluate(`(async () => {
    const api = await import('/src/windowVisibility.ts');
    await Promise.all([
      api.setAuxiliaryWindowVisibility('pip', true),
      api.setAuxiliaryWindowVisibility('pip', false),
      api.setAuxiliaryWindowVisibility('calendar', true),
      api.setAuxiliaryWindowVisibility('calendar', false),
    ]);
  })()`);
  await wait(400);
  assert.deepEqual(await visibility(), { main: true, pip: false, calendar: false }, "late show handlers must not override the final hidden preference");

  await windows.main.evaluate("document.querySelector('[aria-label=\"설정\"]')?.click()");
  await wait(150);
  await mkdir("qa/.tmp", { recursive: true });
  const { data: settingsScreenshot } = await windows.main.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile("qa/.tmp/window-visibility-settings.png", Buffer.from(settingsScreenshot, "base64"));
  assert.equal(await windows.main.evaluate("document.querySelector('[aria-label=\"PIP 표시\"]')?.getAttribute('aria-checked')"), "false");
  await windows.main.evaluate("document.querySelector('[aria-label=\"PIP 표시\"]')?.click()");
  await wait(300);
  assert.equal((await visibility()).pip, true, "Main PIP switch must show PIP");

  await windows.pip.evaluate("document.querySelector('[aria-label=\"PIP 펼치기\"]')?.click()");
  await wait(200);
  await windows.pip.evaluate("document.querySelector('[aria-label=\"PIP 숨기기\"]')?.click()");
  await wait(250);
  assert.equal((await visibility()).pip, false, "PIP X must hide the group");
  await windows.main.evaluate("document.querySelector('[aria-label=\"PIP 표시\"]')?.click()");
  await wait(300);
  assert.deepEqual(await windows.pip.evaluate("({ expanded: document.querySelector('.pip-v02--expanded') !== null, width: innerWidth, height: innerHeight })"), { expanded: true, width: 312, height: 194 });

  await windows.pip.evaluate("document.querySelector('[aria-label=\"Pet Mode로 전환\"]')?.click()");
  await wait(250);
  assert.equal((await visibility()).pip, true, "Pet counts as visible PIP group");
  await windows.main.evaluate("document.querySelector('[aria-label=\"PIP 표시\"]')?.click()");
  await wait(250);
  assert.equal((await visibility()).pip, false, "Main PIP switch must hide active Pet too");

  await setVisible("pip", true);
  await wait(250);
  await windows.pip.evaluate(`(async () => {
    const tauri = await import('/node_modules/.vite/deps/@tauri-apps_api_window.js');
    await tauri.getCurrentWindow().close();
  })()`);
  await wait(250);
  assert.equal((await visibility()).pip, false, "native PIP close request must hide without destroying the WebView");
  assert.ok(await windows.pip.evaluate("Boolean(document.querySelector('.pip-v02'))"));

  await windows.main.evaluate("document.querySelector('[aria-label=\"Calendar 표시\"]')?.click()");
  await wait(300);
  assert.equal((await visibility()).calendar, true, "Main Calendar switch must show Calendar");
  await windows.calendar.evaluate("document.querySelector('[aria-label=\"이전 달\"]')?.click()");
  await windows.calendar.evaluate("document.querySelector('[aria-label=\"Calendar 숨기기\"]')?.click()");
  await wait(250);
  assert.equal((await visibility()).calendar, false, "Calendar X must hide only Calendar");
  await windows.main.evaluate("document.querySelector('[aria-label=\"Calendar 표시\"]')?.click()");
  await wait(350);
  const today = new Date();
  assert.equal(await windows.calendar.evaluate("document.querySelector('.calendar-header h1')?.textContent"), `${today.getMonth() + 1}월`, "Calendar reopen must return to current month");
  assert.equal(await windows.calendar.evaluate("document.querySelector('.calendar-date--selected')?.getAttribute('aria-label')?.slice(0, 10)"), [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-"));
  await windows.calendar.evaluate(`(async () => {
    const tauri = await import('/node_modules/.vite/deps/@tauri-apps_api_window.js');
    await tauri.getCurrentWindow().close();
  })()`);
  await wait(250);
  assert.equal((await visibility()).calendar, false, "native Calendar close request must hide without destroying the WebView");
  assert.ok(await windows.calendar.evaluate("Boolean(document.querySelector('.calendar-window'))"));

  const focusAfter = await windows.main.evaluate(`(async () => {
    const repositories = await import('/src/data/repositories/index.ts');
    const active = await repositories.focusSessionRepository.getActive();
    return active && { id: active.id, taskId: active.taskId, status: active.status };
  })()`);
  assert.deepEqual(focusAfter, focusBefore, "hide/show must not create or mutate FocusSession");

  console.log(JSON.stringify({ mainDefaultInvariant: true, rapidToggleRace: true, mainToggles: true, pipClose: true, petClose: true, calendarClose: true, nativeCloseIntercepted: true, calendarReopenToday: true, focusSessionUnchanged: true, screenshot: "qa/.tmp/window-visibility-settings.png" }, null, 2));
} finally {
  await setVisible("pip", false);
  await setVisible("calendar", false);
  await windows.main.evaluate(`(() => {
    const saved = ${JSON.stringify(savedPreference)};
    if (saved.visibility === null) localStorage.removeItem('study-os:auxiliary-visibility:v1');
    else localStorage.setItem('study-os:auxiliary-visibility:v1', saved.visibility);
    if (saved.pip === null) localStorage.removeItem('study-os:pip-visible:v1');
    else localStorage.setItem('study-os:pip-visible:v1', saved.pip);
    if (saved.calendar === null) localStorage.removeItem('study-os:calendar-visible:v1');
    else localStorage.setItem('study-os:calendar-visible:v1', saved.calendar);
    if (saved.mode === null) localStorage.removeItem('study-os:pip-mode:v1');
    else localStorage.setItem('study-os:pip-mode:v1', saved.mode);
  })()`);
  const legacy = savedPreference.visibility ? JSON.parse(savedPreference.visibility) : { pip: false, calendar: false };
  const restored = {
    pip: savedPreference.pip === "true" ? true : savedPreference.pip === "false" ? false : legacy.pip === true,
    calendar: savedPreference.calendar === "true" ? true : savedPreference.calendar === "false" ? false : legacy.calendar === true,
  };
  if (restored.pip) await setVisible("pip", true);
  if (restored.calendar) await setVisible("calendar", true);
  await windows.main.evaluate(`(() => {
    const saved = ${JSON.stringify(savedPreference)};
    if (saved.visibility === null) localStorage.removeItem('study-os:auxiliary-visibility:v1');
    else localStorage.setItem('study-os:auxiliary-visibility:v1', saved.visibility);
    if (saved.pip === null) localStorage.removeItem('study-os:pip-visible:v1');
    else localStorage.setItem('study-os:pip-visible:v1', saved.pip);
    if (saved.calendar === null) localStorage.removeItem('study-os:calendar-visible:v1');
    else localStorage.setItem('study-os:calendar-visible:v1', saved.calendar);
  })()`);
  for (const [, session] of entries) session.close();
}
}
