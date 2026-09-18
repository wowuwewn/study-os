import { emit, emitTo } from "@tauri-apps/api/event";
import { getAllWindows } from "@tauri-apps/api/window";

export type AuxiliaryWindow = "pip" | "calendar";
export type AuxiliaryVisibility = Record<AuxiliaryWindow, boolean>;
export type StoredPipMode = "compact" | "expanded" | "pet";
export type VisibilityRequest = { visible: boolean; requestId: number };

export const AUXILIARY_VISIBILITY_KEY = "study-os:auxiliary-visibility:v1";
export const PIP_VISIBILITY_KEY = "study-os:pip-visible:v1";
export const CALENDAR_VISIBILITY_KEY = "study-os:calendar-visible:v1";
export const PIP_MODE_KEY = "study-os:pip-mode:v1";
export const AUXILIARY_VISIBILITY_CHANGED_EVENT = "study-os-auxiliary-visibility-changed";
export const PIP_VISIBILITY_REQUEST_EVENT = "study-os-pip-visibility-request";
export const CALENDAR_VISIBILITY_REQUEST_EVENT = "study-os-calendar-visibility-request";

const DEFAULT_VISIBILITY: AuxiliaryVisibility = { pip: false, calendar: false };
let visibilityRequestSequence = 0;

function storageOrNull(storage?: Storage) {
  if (storage) return storage;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function parseAuxiliaryVisibility(value: string | null): AuxiliaryVisibility {
  if (!value) return { ...DEFAULT_VISIBILITY };
  try {
    const parsed = JSON.parse(value) as Partial<AuxiliaryVisibility>;
    return {
      pip: parsed.pip === true,
      calendar: parsed.calendar === true,
    };
  } catch {
    return { ...DEFAULT_VISIBILITY };
  }
}

export function readAuxiliaryVisibility(storage?: Storage): AuxiliaryVisibility {
  const target = storageOrNull(storage);
  try {
    const legacy = parseAuxiliaryVisibility(target?.getItem(AUXILIARY_VISIBILITY_KEY) ?? null);
    const pip = target?.getItem(PIP_VISIBILITY_KEY);
    const calendar = target?.getItem(CALENDAR_VISIBILITY_KEY);
    return {
      pip: pip === "true" ? true : pip === "false" ? false : legacy.pip,
      calendar: calendar === "true" ? true : calendar === "false" ? false : legacy.calendar,
    };
  } catch {
    return { ...DEFAULT_VISIBILITY };
  }
}

export function writeAuxiliaryVisibility(
  windowName: AuxiliaryWindow,
  visible: boolean,
  storage?: Storage,
) {
  const next = { ...readAuxiliaryVisibility(storage), [windowName]: visible };
  try {
    storageOrNull(storage)?.setItem(
      windowName === "pip" ? PIP_VISIBILITY_KEY : CALENDAR_VISIBILITY_KEY,
      String(visible),
    );
  } catch {
    // Window visibility remains usable for the current run if persistence is unavailable.
  }
  return next;
}

export function readPipMode(storage?: Storage): StoredPipMode {
  try {
    const mode = storageOrNull(storage)?.getItem(PIP_MODE_KEY);
    return mode === "expanded" || mode === "pet" ? mode : "compact";
  } catch {
    return "compact";
  }
}

export function writePipMode(mode: StoredPipMode, storage?: Storage) {
  try {
    storageOrNull(storage)?.setItem(PIP_MODE_KEY, mode);
  } catch {
    // Use compact as the next-run fallback when persistence is unavailable.
  }
}

export async function getAuxiliaryWindowVisibility(): Promise<AuxiliaryVisibility> {
  const windows = await getAllWindows();
  const pip = windows.find((appWindow) => appWindow.label === "pip");
  const pet = windows.find((appWindow) => appWindow.label === "pet");
  const calendar = windows.find((appWindow) => appWindow.label === "calendar");
  const [pipVisible, petVisible, calendarVisible] = await Promise.all([
    pip?.isVisible() ?? false,
    pet?.isVisible() ?? false,
    calendar?.isVisible() ?? false,
  ]);
  return { pip: pipVisible || petVisible, calendar: calendarVisible };
}

export async function setAuxiliaryWindowVisibility(
  windowName: AuxiliaryWindow,
  visible: boolean,
) {
  const next = writeAuxiliaryVisibility(windowName, visible);
  const request: VisibilityRequest = {
    visible,
    requestId: Date.now() * 1_000 + (++visibilityRequestSequence % 1_000),
  };
  const windows = await getAllWindows();

  if (windowName === "pip") {
    const pip = windows.find((appWindow) => appWindow.label === "pip");
    const pet = windows.find((appWindow) => appWindow.label === "pet");
    if (visible) {
      await pet?.hide();
      await emitTo("pip", PIP_VISIBILITY_REQUEST_EVENT, request);
    } else {
      await emitTo("pip", PIP_VISIBILITY_REQUEST_EVENT, request);
      await Promise.all([pip?.hide(), pet?.hide()]);
    }
  } else {
    const calendar = windows.find((appWindow) => appWindow.label === "calendar");
    if (visible) {
      await emitTo("calendar", CALENDAR_VISIBILITY_REQUEST_EVENT, request);
    } else {
      await emitTo("calendar", CALENDAR_VISIBILITY_REQUEST_EVENT, request);
      await calendar?.hide();
    }
  }

  await emit(AUXILIARY_VISIBILITY_CHANGED_EVENT, next);
  return next;
}
