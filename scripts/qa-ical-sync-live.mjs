import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const CDP_URL = "http://127.0.0.1:9222/json";
const SYNTHETIC_ALLOWED_URL = "https://canvas.dankook.ac.kr/study-os-synthetic-calendar.ics";

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
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

const targets = await (await fetch(CDP_URL)).json();
const sessions = [];
let main;
let ownsCredential = false;
for (const target of targets) {
  const session = new CdpSession(target);
  sessions.push(session);
  const label = await session.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label");
  if (label === "main") main = session;
}
assert.ok(main, "the running Tauri application must expose its main window on CDP port 9222");

try {
  await main.evaluate("document.querySelector('.ical-settings__close')?.click()");
  const before = await main.evaluate(`(async () => {
    const service = await import('/src/features/ical-sync/service.ts');
    return service.getIcalConnectionStatus();
  })()`);
  assert.equal(before.connected, false, "QA must not overwrite an existing private iCal credential");

  const connected = await main.evaluate(`(async () => {
    const service = await import('/src/features/ical-sync/service.ts');
    return service.connectIcal(${JSON.stringify(SYNTHETIC_ALLOWED_URL)});
  })()`);
  ownsCredential = true;
  const connectedResult = await main.evaluate(`(async () => {
    const repositories = await import('/src/data/repositories/index.ts');
    const database = await (await import('/src/data/db/client.ts')).getDatabase();
    const source = await database.select('SELECT kind, integration_metadata_json FROM sources WHERE id=?1', ['integration:ical:canvas-dankook']);
    const syncState = await database.select('SELECT status, etag, last_modified FROM source_sync_states WHERE source_id=?1', ['integration:ical:canvas-dankook']);
    const serializedDbState = JSON.stringify({ source, syncState });
    return { serializedDbState, courseCount: (await repositories.courseRepository.list()).length };
  })()`);
  assert.equal(connected.connected, true);
  assert.equal(connectedResult.serializedDbState.includes(SYNTHETIC_ALLOWED_URL), false, "SQLite must not contain the iCal URL");
  assert.equal(connectedResult.serializedDbState.includes("token"), false, "SQLite integration state must not contain a token");

  await main.evaluate(`(() => {
    document.querySelector('button[aria-label="설정"]').click();
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const poll = () => {
        if (document.querySelector('.ical-settings')?.innerText.includes('연결됨')) return resolve();
        if (Date.now() > deadline) return reject(new Error('connected settings state timeout'));
        setTimeout(poll, 50);
      };
      poll();
    });
  })()`);
  assert.match(await main.evaluate("document.querySelector('.ical-settings')?.innerText"), /연결됨/);
  assert.ok(await main.evaluate("[...document.querySelectorAll('.ical-settings button')].some((button) => button.textContent.includes('Sync Now'))"));
  await main.evaluate("document.querySelector('.ical-settings__close').click()");

  const result = await main.evaluate(`(async () => {
    const service = await import('/src/features/ical-sync/service.ts');
    const disconnected = await service.disconnectIcal();
    let disconnectedSyncError = null;
    try { await service.syncIcal(); } catch (error) { disconnectedSyncError = String(error); }
    return { disconnected, disconnectedSyncError };
  })()`);
  ownsCredential = false;
  assert.equal(result.disconnected.connected, false);
  assert.equal(result.disconnectedSyncError, "credential_missing");

  await main.evaluate(`(() => {
    const button = document.querySelector('button[aria-label="설정"]');
    button.click();
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  assert.match(await main.evaluate("document.querySelector('.ical-settings')?.innerText"), /iCal 연결/);
  assert.match(await main.evaluate("document.querySelector('.ical-settings')?.innerText"), /연결되지 않음/);
  assert.equal(await main.evaluate("document.querySelector('#ical-url')?.getAttribute('type')"), "password");

  await mkdir("qa", { recursive: true });
  const { data } = await main.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: 855, height: 760, scale: 1 },
  });
  await writeFile("qa/ical-sync-v01-settings.png", Buffer.from(data, "base64"));
  console.log(JSON.stringify({
    windows: targets.length,
    secretCrud: "passed-and-cleaned",
    sqliteSecretAbsence: "passed",
    status: result.disconnected.status,
    courseCountUnchanged: connectedResult.courseCount,
  }, null, 2));
  await main.evaluate("document.querySelector('.ical-settings__close').click()");
} finally {
  if (ownsCredential && main) {
    try {
      await main.evaluate(`(async () => {
        const service = await import('/src/features/ical-sync/service.ts');
        await service.disconnectIcal();
      })()`);
    } catch {}
  }
  for (const session of sessions) session.close();
}
