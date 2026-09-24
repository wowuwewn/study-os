import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { parseQuickAdd } from "./parser";
import { saveQuickAdd } from "./service";
import type { QuickAddEntityType, QuickAddTypeOverride } from "./types";
import { QUICK_ADD_OPENED_EVENT } from "./window";

const EXAMPLES = [
  "수학 과제 다음 주 화요일까지",
  "Java 40분",
  "내일 3시 피부과",
  "멋사 회의 금요일 7시",
];

function entityLabel(type: QuickAddEntityType) {
  return type === "study-task" ? "할 일" : "일정";
}

function previewSummary(parsed: ReturnType<typeof parseQuickAdd>) {
  const parts: string[] = [];
  if (parsed.dateLabel) parts.push(parsed.hasDeadline ? `${parsed.dateLabel} 마감` : parsed.dateLabel);
  if (parsed.timeLabel) parts.push(parsed.timeLabel);
  if (parsed.estimatedMinutes) parts.push(`예상 ${parsed.estimatedMinutes}분`);
  return parts.join(" · ") || "날짜 없이 보관";
}

export default function QuickAddWindow() {
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [input, setInput] = useState("");
  const [referenceNow, setReferenceNow] = useState(() => new Date());
  const [typeOverride, setTypeOverride] = useState<QuickAddTypeOverride>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const parsed = useMemo(
    () => parseQuickAdd(input, { now: referenceNow, typeOverride }),
    [input, referenceNow, typeOverride],
  );

  const focusInput = () => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const reset = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setInput("");
    setTypeOverride(null);
    setStatus("idle");
    setMessage("");
    setReferenceNow(new Date());
  };

  const hide = async () => {
    reset();
    await getCurrentWindow().hide();
  };

  useEffect(() => {
    focusInput();
    const unlistenPromise = listen(QUICK_ADD_OPENED_EVENT, () => {
      reset();
      focusInput();
    });
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      void hide();
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else cleanup = unlisten;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (status === "saving" || status === "saved") return;
    if (!parsed.valid) {
      setStatus("error");
      setMessage(parsed.error ?? "입력 내용을 확인해 주세요.");
      focusInput();
      return;
    }

    setStatus("saving");
    setMessage("추가 중…");
    try {
      await saveQuickAdd(parsed);
      setStatus("saved");
      setMessage(`${entityLabel(parsed.entityType)} 추가됨`);
      closeTimer.current = window.setTimeout(() => void hide(), 360);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "저장하지 못했어요.");
      focusInput();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void hide();
      return;
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      setTypeOverride(parsed.entityType === "study-task" ? "event" : "study-task");
      setStatus("idle");
      setMessage("");
    }
  };

  return (
    <main className="quick-add-window" data-tauri-drag-region>
      <span className="quick-add-mark" aria-hidden="true">S</span>
      <form className="quick-add-form" onSubmit={(event) => void submit(event)}>
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => {
            setInput(event.currentTarget.value);
            setTypeOverride(null);
            setStatus("idle");
            setMessage("");
          }}
          onKeyDown={handleKeyDown}
          placeholder="무엇을 추가할까요?"
          aria-label="할 일이나 일정 빠르게 추가"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        <div className="quick-add-controls" aria-hidden="true">
          <kbd>Tab</kbd>
          <span>{entityLabel(parsed.entityType)}</span>
          <span>↵ 추가</span>
        </div>
      </form>

      {input || status === "error" ? (
        <div className={`quick-add-preview quick-add-preview--${status}`} role="status">
          <span className="quick-add-preview-type">{status === "saved" ? "✓" : entityLabel(parsed.entityType)}</span>
          <strong>{status === "idle" ? parsed.title || "입력 확인" : message}</strong>
          {status === "idle" && <span>{previewSummary(parsed)}</span>}
          {status === "error" && <span>{message}</span>}
        </div>
      ) : (
        <div className="quick-add-examples">
          <span className="quick-add-example-label">✦ 예시</span>
          {EXAMPLES.map((example) => (
            <button
              type="button"
              key={example}
              onClick={() => {
                setInput(example);
                setReferenceNow(new Date());
                focusInput();
              }}
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
