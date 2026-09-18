import assert from "node:assert/strict";

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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
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
const savedVisibility = await windows.main.evaluate(`({
  legacy: localStorage.getItem('study-os:auxiliary-visibility:v1'),
  pip: localStorage.getItem('study-os:pip-visible:v1'),
  calendar: localStorage.getItem('study-os:calendar-visible:v1'),
  mode: localStorage.getItem('study-os:pip-mode:v1')
})`);

try {
  await windows.main.evaluate("[...document.querySelectorAll('.main-tab')].find((node) => node.textContent === '오늘')?.click()");
  await windows.main.evaluate(`(async () => {
    const visibility = await import('/src/windowVisibility.ts');
    await visibility.setAuxiliaryWindowVisibility('pip', true);
  })()`);
  await wait(250);
  const focusBefore = await windows.main.evaluate(`(async () => {
    const repositories = await import('/src/data/repositories/index.ts');
    return repositories.focusSessionRepository.getActive();
  })()`);
  const mainQuest = await windows.main.evaluate("document.querySelector('#quest-detail-heading')?.textContent");
  const pipQuest = await windows.pip.evaluate("document.querySelector('.pip-v02__quest-title')?.textContent");
  assert.equal(pipQuest, mainQuest, "Main and PIP must share the current quest");

  await windows.pip.evaluate("document.querySelector('[aria-label=\"PIP 펼치기\"]')?.click()");
  await wait(400);
  assert.equal(await windows.pip.evaluate("document.querySelector('.pip-v02')?.classList.contains('pip-v02--expanded')"), true);
  const expandedSize = await windows.pip.evaluate("({ width: window.innerWidth, height: window.innerHeight })");
  assert.deepEqual(expandedSize, { width: 312, height: 194 });

  await windows.pip.evaluate("document.querySelector('[aria-label=\"Pet Mode로 전환\"]')?.click()");
  await wait(400);
  assert.match(await windows.pet.evaluate("document.querySelector('.pet-window')?.className"), /pet-window--(idle|running|paused|completed)/);

  await windows.pet.evaluate(`(() => {
    const pet = document.querySelector('.danwoong-pet');
    pet?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    pet?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  })()`);
  const restored = await (async () => {
    const deadline = Date.now() + 3000;
    while (Date.now() <= deadline) {
      if (await windows.pip.evaluate("document.querySelector('.pip-v02')?.classList.contains('pip-v02--compact')")) return true;
      await wait(100);
    }
    return false;
  })();
  assert.equal(restored, true);
  const compactSize = await windows.pip.evaluate("({ width: window.innerWidth, height: window.innerHeight })");
  assert.deepEqual(compactSize, { width: 312, height: 116 });

  const focusAfter = await windows.main.evaluate(`(async () => {
    const repositories = await import('/src/data/repositories/index.ts');
    return repositories.focusSessionRepository.getActive();
  })()`);
  assert.deepEqual(focusAfter, focusBefore, "PIP/Pet mode QA must not mutate FocusSession state");
  console.log(JSON.stringify({ windows: Object.keys(windows).sort(), sharedQuest: true, expandedSize, compactSize, petState: true, focusSessionUnchanged: true }, null, 2));
} finally {
  try {
    const legacy = savedVisibility.legacy ? JSON.parse(savedVisibility.legacy) : { pip: false };
    const savedPip = savedVisibility.pip === "true" ? true : savedVisibility.pip === "false" ? false : legacy.pip === true;
    await windows.main.evaluate(`(async () => {
      const visibility = await import('/src/windowVisibility.ts');
      await visibility.setAuxiliaryWindowVisibility('pip', ${savedPip});
      const original = ${JSON.stringify(savedVisibility)};
      for (const [key, value] of [
        ['study-os:auxiliary-visibility:v1', original.legacy],
        ['study-os:pip-visible:v1', original.pip],
        ['study-os:calendar-visible:v1', original.calendar],
        ['study-os:pip-mode:v1', original.mode],
      ]) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
    })()`);
  } catch {}
  for (const [, session] of entries) session.close();
}
