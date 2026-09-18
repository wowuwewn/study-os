import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { notifyStudyDataChanged, STUDY_DATA_CHANGED_EVENT } from "../../data/studyData";
import { TASK_GROUPS, type TaskListItem } from "./model";
import {
  loadTasksSurface,
  setTaskItemOutcome,
  startTaskItem,
  updateTaskItem,
  type TasksSurfaceData,
} from "./service";

function statusLabel(item: TaskListItem) {
  if (item.kind === "assignment") return "가상 과제";
  if (item.status === "doing") return "집중 중";
  if (item.status === "paused") return "일시정지";
  if (item.status === "done") return "완료";
  if (item.status === "cancelled") return "취소";
  return "할 일";
}

function formatSafeStart(item: TaskListItem) {
  const safe = item.lastSafeStart;
  if (!item.isRecommended) return "현재 추천 과제가 아니에요.";
  if (!safe) return "예상 시간 또는 마감을 입력하면 계산할 수 있어요.";
  if (safe.status === "at_risk" || !safe.startAt) return "안전 시작 시점을 지났어요.";
  return `안전하게 시작할 마지막 시점 · ${new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(safe.startAt))}`;
}

export default function TasksView() {
  const [data, setData] = useState<TasksSurfaceData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [priority, setPriority] = useState("50");
  const [estimate, setEstimate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await loadTasksSurface();
      setData(next);
      setSelectedId((current) => current && next.items.some((item) => item.id === current)
        ? current
        : next.items[0]?.id ?? null);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    void reload();
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void listen(STUDY_DATA_CHANGED_EVENT, () => void reload()).then((unlisten) => {
      if (cancelled) unlisten();
      else cleanup = unlisten;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [reload]);

  const selected = useMemo(
    () => data?.items.find((item) => item.id === selectedId) ?? null,
    [data, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    setPriority(String(selected.priority ?? 50));
    setEstimate(selected.estimatedMinutes ? String(selected.estimatedMinutes) : "");
    setDeadline(selected.deadlineDate ?? "");
    setMessage(null);
  }, [selected]);

  const mutate = async (operation: () => Promise<void>, success: string) => {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      await operation();
      await notifyStudyDataChanged();
      await reload();
      setMessage(success);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };

  const isCompleted = selected?.group === "completed";
  const activeIsDifferent = Boolean(data?.activeTaskId && data.activeTaskId !== selected?.entityId);

  return (
    <div className="tasks-surface">
      <section className="tasks-list-pane" aria-labelledby="tasks-view-heading">
        <header className="tasks-view-header">
          <div><h1 id="tasks-view-heading">과제</h1><span>할 일과 학교 과제를 한곳에서 봐요.</span></div>
          <strong>{data?.items.filter((item) => item.group !== "completed").length ?? 0}</strong>
        </header>
        <div className="task-groups">
          {TASK_GROUPS.map((group) => {
            const items = data?.items.filter((item) => item.group === group.key) ?? [];
            return (
              <section className="task-group" key={group.key}>
                <header><h2>{group.label}</h2><span>{items.length}</span></header>
                {items.length > 0 && (
                  <ul>
                    {items.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={item.id === selectedId ? "task-row task-row--selected" : "task-row"}
                          onClick={() => setSelectedId(item.id)}
                        >
                          <span className={`task-kind-dot task-kind-dot--${item.kind}`} aria-hidden="true" />
                          <span className="task-row-copy">
                            <strong>{item.title}</strong>
                            <small>{statusLabel(item)}{item.isRecommended ? " · 지금 추천" : ""}</small>
                          </span>
                          <time>{item.deadlineDate?.slice(5).replace("-", ".") ?? "—"}</time>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </section>

      <aside className="task-editor" aria-labelledby="task-editor-heading">
        {selected ? (
          <>
            <span className="task-editor-kind">{statusLabel(selected)}</span>
            <h2 id="task-editor-heading">{selected.title}</h2>
            {selected.recommendationReasons.length > 0 && (
              <p className="task-editor-reasons">{selected.recommendationReasons.join(" · ")}</p>
            )}
            <p className="task-safe-start">{formatSafeStart(selected)}</p>
            <div className="task-editor-fields">
              {selected.kind === "task" ? (
                <>
                  <label>우선순위<input type="number" min="0" max="100" value={priority} onChange={(event) => setPriority(event.currentTarget.value)} disabled={pending || isCompleted} /></label>
                  <label>예상 시간<input type="number" min="1" max="1440" placeholder="분" value={estimate} onChange={(event) => setEstimate(event.currentTarget.value)} disabled={pending || isCompleted} /></label>
                </>
              ) : (
                <p className="task-editor-hint">학교 과제는 시작할 때 실행 가능한 StudyTask로 만들어져요. 그 뒤 우선순위와 예상 시간을 설정할 수 있어요.</p>
              )}
              <label>마감일<input type="date" value={deadline} onChange={(event) => setDeadline(event.currentTarget.value)} disabled={pending || isCompleted} /></label>
            </div>
            {!isCompleted && (
              <button
                className="task-save-button"
                type="button"
                disabled={pending}
                onClick={() => void mutate(
                  () => updateTaskItem(selected, {
                    priority: priority ? Number(priority) : null,
                    estimatedMinutes: estimate ? Number(estimate) : null,
                    deadlineDate: deadline || null,
                  }),
                  "변경 내용을 저장했어요.",
                )}
              >저장</button>
            )}
            {!isCompleted && (
              <div className="task-editor-actions">
                <button
                  className="task-start-button"
                  type="button"
                  disabled={pending || activeIsDifferent}
                  onClick={() => void mutate(() => startTaskItem(selected), "집중을 시작했어요.")}
                >{data?.activeTaskId === selected.entityId ? "계속하기" : "시작"}</button>
                <button type="button" disabled={pending} onClick={() => void mutate(() => setTaskItemOutcome(selected, "complete"), "완료했어요.")}>완료</button>
                <button type="button" disabled={pending} onClick={() => void mutate(() => setTaskItemOutcome(selected, "cancel"), "취소했어요.")}>취소</button>
              </div>
            )}
            {activeIsDifferent && <p className="task-editor-message">다른 집중 세션이 진행 중이라 새 세션을 시작할 수 없어요.</p>}
            {message && <p className="task-editor-message" role="status">{message}</p>}
          </>
        ) : (
          <div className="task-editor-empty"><h2 id="task-editor-heading">표시할 과제가 없어요.</h2><p>Quick Add로 새 할 일을 추가해 보세요.</p></div>
        )}
      </aside>
    </div>
  );
}
