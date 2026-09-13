import { invoke } from "@tauri-apps/api/core";
import type { IcalConnectionStatus, IcalSyncResult } from "./types";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_endpoint: "https://canvas.dankook.ac.kr 주소만 연결할 수 있어요.",
  credential_missing: "저장된 iCal 연결 정보가 없어요.",
  credential_unavailable: "Windows 자격 증명 관리자에 접근할 수 없어요.",
  sync_in_progress: "이미 동기화하고 있어요.",
  network_error: "e-Campus에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
  http_error: "e-Campus가 동기화 요청을 처리하지 못했어요.",
  response_too_large: "iCal 응답이 허용 크기를 초과했어요.",
  invalid_calendar: "지원할 수 없는 iCal 형식이 포함되어 있어요.",
  database_error: "동기화 결과를 안전하게 저장하지 못했어요.",
  stale_sync: "이전 동기화가 비정상 종료되어 다시 시도해야 해요.",
};

export function icalErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? "동기화 중 알 수 없는 문제가 발생했어요.";
}

export function getIcalConnectionStatus(): Promise<IcalConnectionStatus> {
  return invoke<IcalConnectionStatus>("ical_connection_status");
}

export function connectIcal(url: string): Promise<IcalConnectionStatus> {
  return invoke<IcalConnectionStatus>("connect_ical", { url });
}

export function disconnectIcal(): Promise<IcalConnectionStatus> {
  return invoke<IcalConnectionStatus>("disconnect_ical");
}

export function syncIcal(): Promise<IcalSyncResult> {
  return invoke<IcalSyncResult>("sync_ical");
}
