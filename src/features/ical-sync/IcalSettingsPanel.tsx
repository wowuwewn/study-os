import { useCallback, useEffect, useState, type FormEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  connectIcal,
  disconnectIcal,
  getIcalConnectionStatus,
  icalErrorMessage,
  syncIcal,
} from "./service";
import type { IcalConnectionStatus, IcalSyncResult } from "./types";
import {
  AUXILIARY_VISIBILITY_CHANGED_EVENT,
  getAuxiliaryWindowVisibility,
  setAuxiliaryWindowVisibility,
  type AuxiliaryVisibility,
  type AuxiliaryWindow,
} from "../../windowVisibility";

type Props = { onClose: () => void };

function formatLastSync(value: string | null) {
  if (!value) return "아직 동기화하지 않음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function IcalSettingsPanel({ onClose }: Props) {
  const [status, setStatus] = useState<IcalConnectionStatus | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [result, setResult] = useState<IcalSyncResult | null>(null);
  const [visibility, setVisibility] = useState<AuxiliaryVisibility>({ pip: false, calendar: false });
  const [visibilityBusy, setVisibilityBusy] = useState<AuxiliaryWindow | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await getIcalConnectionStatus();
      setStatus(next);
      setErrorCode(next.lastErrorCode);
    } catch (reason) {
      setErrorCode(String(reason));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void getAuxiliaryWindowVisibility().then((next) => {
      if (!cancelled) setVisibility(next);
    });
    void listen<AuxiliaryVisibility>(AUXILIARY_VISIBILITY_CHANGED_EVENT, (event) => {
      setVisibility(event.payload);
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else cleanup = unlisten;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setErrorCode(null);
    try {
      await action();
    } catch (reason) {
      setErrorCode(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleConnect = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const next = await connectIcal(url.trim());
      setStatus(next);
      setUrl("");
      setResult(null);
    });
  };

  const handleSync = () => {
    setResult(null);
    void run(async () => {
      try {
        const nextResult = await syncIcal();
        setResult(nextResult);
      } finally {
        await reload();
      }
    });
  };

  const handleDisconnect = () => {
    void run(async () => {
      const next = await disconnectIcal();
      setStatus(next);
      setResult(null);
      setErrorCode(null);
    });
  };

  const toggleAuxiliaryWindow = (windowName: AuxiliaryWindow) => {
    const visible = !visibility[windowName];
    setVisibilityBusy(windowName);
    setVisibility((current) => ({ ...current, [windowName]: visible }));
    void setAuxiliaryWindowVisibility(windowName, visible)
      .catch((reason) => {
        console.error(`Failed to update ${windowName} visibility`, reason);
        return getAuxiliaryWindowVisibility().then(setVisibility);
      })
      .finally(() => setVisibilityBusy(null));
  };

  const statusLabel = status?.connected
    ? status.status === "ok"
      ? "연결됨 · 정상"
      : status.status === "error"
        ? "연결됨 · 확인 필요"
        : "연결됨"
    : "연결되지 않음";
  const errorMessage = icalErrorMessage(errorCode ?? status?.lastErrorCode ?? null);

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="ical-settings" role="dialog" aria-modal="true" aria-labelledby="ical-settings-title">
        <header>
          <div>
            <span className="ical-settings__eyebrow">e-Campus</span>
            <h2 id="ical-settings-title">iCal 연결</h2>
          </div>
          <button type="button" className="ical-settings__close" onClick={onClose} disabled={busy} aria-label="설정 닫기">×</button>
        </header>

        <div className="ical-settings__status">
          <span className={status?.connected ? "status-dot status-dot--connected" : "status-dot"} aria-hidden="true" />
          <div><strong>{statusLabel}</strong><small>마지막 성공 {formatLastSync(status?.lastSuccessAt ?? null)}</small></div>
        </div>

        <section className="ical-settings__windows" aria-labelledby="auxiliary-windows-heading">
          <h3 id="auxiliary-windows-heading">보조창</h3>
          <div>
            <span><strong>PIP</strong><small>현재 퀘스트와 집중 상태</small></span>
            <button
              type="button"
              role="switch"
              aria-checked={visibility.pip}
              aria-label="PIP 표시"
              disabled={visibilityBusy === "pip"}
              onClick={() => toggleAuxiliaryWindow("pip")}
            ><i aria-hidden="true" /></button>
          </div>
          <div>
            <span><strong>Calendar</strong><small>월간 일정과 마감</small></span>
            <button
              type="button"
              role="switch"
              aria-checked={visibility.calendar}
              aria-label="Calendar 표시"
              disabled={visibilityBusy === "calendar"}
              onClick={() => toggleAuxiliaryWindow("calendar")}
            ><i aria-hidden="true" /></button>
          </div>
        </section>

        {!status?.connected ? (
          <form onSubmit={handleConnect}>
            <label htmlFor="ical-url">공식 e-Campus private iCal URL</label>
            <input
              id="ical-url"
              type="password"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://canvas.dankook.ac.kr/..."
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              required
            />
            <p>주소는 Windows 자격 증명 관리자에만 저장됩니다.</p>
            <button className="ical-settings__primary" type="submit" disabled={busy || !url.trim()}>
              {busy ? "연결 중…" : "연결"}
            </button>
          </form>
        ) : (
          <div className="ical-settings__actions">
            <button className="ical-settings__primary" type="button" onClick={handleSync} disabled={busy}>
              {busy ? "동기화 중…" : "Sync Now"}
            </button>
            <button className="ical-settings__secondary" type="button" onClick={handleDisconnect} disabled={busy}>연결 해제</button>
          </div>
        )}

        {errorMessage && <p className="ical-settings__error" role="status">{errorMessage}</p>}
        {result && (
          <p className="ical-settings__result" role="status">
            {result.notModified
              ? "변경 사항이 없습니다."
              : `일정 ${result.diagnostics.events} · 과제 ${result.diagnostics.assignments} · 반복 ${result.diagnostics.recurringRules}`}
            {result.diagnostics.unsupported > 0 ? ` · 미지원 ${result.diagnostics.unsupported}` : ""}
          </p>
        )}
      </section>
    </div>
  );
}
