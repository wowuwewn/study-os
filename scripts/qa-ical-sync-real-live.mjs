import assert from "node:assert/strict";

const CDP_URL = "http://127.0.0.1:9222/json";
const ICAL_SOURCE = "integration:ical:canvas-dankook";
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
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
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

const snapshotExpression = `(async () => {
  const database = await (await import('/src/data/db/client.ts')).getDatabase();
  const schedule = await import('/src/features/schedule/service.ts');
  const repositories = await import('/src/data/repositories/index.ts');
  const canonical = await database.select(\`SELECT r.id rule_id, r.course_id
    FROM recurring_schedule_rules r
    JOIN semesters s ON s.id=r.semester_id
    LEFT JOIN sources src ON src.id=r.source_id
    WHERE s.starts_on='2026-09-01' AND s.ends_on='2026-12-14'
      AND s.timezone='Asia/Seoul' AND ifnull(src.kind, 'manual')='manual'
      AND r.source_cancelled_at IS NULL AND r.source_removed_at IS NULL
    ORDER BY r.id\`);
  const syncState = await database.select(\`SELECT sync_generation,
    missing_reconciliation_enabled, etag IS NOT NULL has_etag,
    last_modified IS NOT NULL has_last_modified
    FROM source_sync_states WHERE source_id=?1\`, [${JSON.stringify(ICAL_SOURCE)}]);
  const provider = await database.select(\`SELECT external_id, entity_kind,
    COALESCE(event_id, assignment_id, recurring_rule_id, schedule_exception_id, course_id) entity_id,
    last_seen_generation, explicitly_cancelled, removed_at IS NOT NULL removed
    FROM external_sync_items WHERE source_id=?1 ORDER BY external_id\`, [${JSON.stringify(ICAL_SOURCE)}]);
  const providerEntities = await database.select(\`
    SELECT 'event' kind, id, updated_at, source_cancelled_at IS NOT NULL cancelled,
      source_removed_at IS NOT NULL removed FROM events WHERE source_id=?1
    UNION ALL
    SELECT 'assignment' kind, id, updated_at, status='cancelled' cancelled,
      source_removed_at IS NOT NULL removed FROM assignments WHERE source_id=?1
    UNION ALL
    SELECT 'recurring_rule' kind, id, updated_at, source_cancelled_at IS NOT NULL cancelled,
      source_removed_at IS NOT NULL removed FROM recurring_schedule_rules WHERE source_id=?1
    ORDER BY kind, id\`, [${JSON.stringify(ICAL_SOURCE)}]);
  const manualState = {
    events: await database.select(\`SELECT id, updated_at FROM events
      WHERE ifnull(source_id, '')<>?1 ORDER BY id\`, [${JSON.stringify(ICAL_SOURCE)}]),
    assignments: await database.select(\`SELECT id, status, updated_at FROM assignments
      WHERE ifnull(source_id, '')<>?1 ORDER BY id\`, [${JSON.stringify(ICAL_SOURCE)}]),
    rules: await database.select(\`SELECT id, updated_at FROM recurring_schedule_rules
      WHERE ifnull(source_id, '')<>?1 ORDER BY id\`, [${JSON.stringify(ICAL_SOURCE)}]),
    tasks: await database.select(\`SELECT id, status, updated_at, completed_at
      FROM study_tasks ORDER BY id\`),
  };
  const entityCounts = await database.select(\`SELECT entity_kind, COUNT(*) count
    FROM external_sync_items WHERE source_id=?1 GROUP BY entity_kind ORDER BY entity_kind\`, [${JSON.stringify(ICAL_SOURCE)}]);
  const providerEvents = await database.select(\`SELECT COUNT(*) count FROM events
    WHERE source_id=?1 AND source_cancelled_at IS NULL AND source_removed_at IS NULL\`, [${JSON.stringify(ICAL_SOURCE)}]);
  const today = await schedule.listTodaySchedule();
  const focus = await repositories.focusSessionRepository.getActive();
  return {
    canonicalRuleIds: canonical.map((row) => row.rule_id),
    canonicalCourseIds: [...new Set(canonical.map((row) => row.course_id))],
    syncState: syncState[0],
    providerIdentity: provider,
    providerEntities,
    manualState,
    entityCounts,
    providerEventCount: providerEvents[0]?.count ?? 0,
    todayCount: today.length,
    providerTodayCount: today.filter((item) => item.sourceId === ${JSON.stringify(ICAL_SOURCE)}).length,
    recurringTodayCount: today.filter((item) => item.origin === 'recurring').length,
    focus,
  };
})()`;

try {
  const status = await main.evaluate(`(async () => (await import('/src/features/ical-sync/service.ts')).getIcalConnectionStatus())()`);
  assert.equal(status.connected, true, "an existing Windows Credential Manager connection is required");

  const before = await main.evaluate(snapshotExpression);
  assert.equal(before.canonicalCourseIds.length, 7, "canonical manual timetable must retain 7 courses");
  assert.equal(before.canonicalRuleIds.length, 11, "canonical manual timetable must retain 11 weekly rules");
  assert.equal(before.syncState.missing_reconciliation_enabled, 0,
    "missing-item reconciliation must remain disabled while feed authority is unverified");

  const first = await main.evaluate(`(async () => (await import('/src/features/ical-sync/service.ts')).syncIcal())()`);
  await wait(750);
  const afterFirst = await main.evaluate(snapshotExpression);
  const renderedTimelineItems = await main.evaluate("document.querySelectorAll('.timeline-item').length");

  const second = await main.evaluate(`(async () => (await import('/src/features/ical-sync/service.ts')).syncIcal())()`);
  assert.equal(second.notModified, true, "repeat sync must use conditional 304 when the feed is unchanged");
  await wait(500);
  const afterSecond = await main.evaluate(snapshotExpression);
  const syncNowUi = await main.evaluate(`(() => {
    document.querySelector('button[aria-label="설정"]')?.click();
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const poll = () => {
        const button = [...document.querySelectorAll('.ical-settings button')]
          .find((candidate) => candidate.textContent.includes('Sync Now'));
        if (button) {
          button.click();
          return resolve(true);
        }
        if (Date.now() > deadline) return reject(new Error('Sync Now control timeout'));
        setTimeout(poll, 50);
      };
      poll();
    });
  })()`);
  assert.equal(syncNowUi, true);
  await wait(1000);
  const uiStatus = await main.evaluate(`(async () => (await import('/src/features/ical-sync/service.ts')).getIcalConnectionStatus())()`);
  assert.equal(uiStatus.status, "ok", "Sync Now UI must finish successfully");
  assert.equal(uiStatus.lastErrorCode, null, "Sync Now UI must not retain an error");
  await main.evaluate("document.querySelector('.ical-settings__close')?.click()");
  const afterUiSync = await main.evaluate(snapshotExpression);

  assert.deepEqual(afterFirst.providerIdentity, afterSecond.providerIdentity, "re-sync must preserve stable provider identities");
  assert.deepEqual(afterFirst.providerEntities, afterSecond.providerEntities,
    "304 must not change provider removal or cancellation state");
  assert.deepEqual(afterFirst.entityCounts, afterSecond.entityCounts, "re-sync must not create duplicates");
  assert.equal(second.generation, afterFirst.syncState.sync_generation,
    "304 result must report the existing generation");
  assert.equal(afterSecond.syncState.sync_generation, afterFirst.syncState.sync_generation,
    "304 must not advance the sync generation");
  assert.equal(afterSecond.syncState.missing_reconciliation_enabled, 0,
    "304 must not enable missing-item reconciliation");
  assert.deepEqual(afterFirst.canonicalRuleIds, before.canonicalRuleIds, "sync must preserve canonical weekly rules");
  assert.deepEqual(afterFirst.canonicalCourseIds, before.canonicalCourseIds, "sync must preserve canonical courses");
  assert.deepEqual(afterFirst.manualState, before.manualState, "sync must preserve all manual domain state");
  assert.deepEqual(afterSecond.manualState, before.manualState, "304 must preserve all manual domain state");
  assert.deepEqual(afterSecond.focus, before.focus, "sync must not mutate Focus state");
  assert.deepEqual(afterUiSync.providerIdentity, afterSecond.providerIdentity,
    "Sync Now UI must preserve provider state when the response is unchanged");
  assert.equal(afterUiSync.syncState.sync_generation, afterSecond.syncState.sync_generation,
    "Sync Now UI 304 must not advance the sync generation");
  assert.equal(afterUiSync.syncState.missing_reconciliation_enabled, 0,
    "Sync Now UI must keep missing-item reconciliation disabled");
  assert.deepEqual(afterUiSync.manualState, before.manualState,
    "Sync Now UI must preserve all manual domain state");
  assert.deepEqual(afterUiSync.focus, before.focus, "Sync Now UI must not mutate Focus state");
  assert.ok(renderedTimelineItems >= 2, "Today timeline must remain rendered after sync notification");
  assert.equal(first.diagnostics.totalItems, first.diagnostics.vevents + first.diagnostics.vtodos);

  console.log(JSON.stringify({
    syncSucceeded: true,
    notModifiedOnResync: second.notModified,
    diagnostics: first.diagnostics,
    applied: {
      inserted: first.inserted,
      updated: first.updated,
      unchanged: first.unchanged,
      entityCounts: afterFirst.entityCounts,
    },
    idempotentResync: true,
    generationUnchangedOn304: true,
    missingReconciliationEnabled: false,
    syncNowUi: true,
    today: {
      total: afterFirst.todayCount,
      provider: afterFirst.providerTodayCount,
      recurring: afterFirst.recurringTodayCount,
      rendered: true,
    },
    canonicalTimetable: { courses: 7, rules: 11, unchanged: true },
    providerEventRows: afterFirst.providerEventCount,
    manualDataUnchanged: true,
    focusUnchanged: true,
  }, null, 2));
} finally {
  for (const session of sessions) session.close();
}
