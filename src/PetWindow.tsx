import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import {
  currentMonitor,
  getCurrentWindow,
  PhysicalPosition,
  Window as TauriWindow,
} from "@tauri-apps/api/window";
import {
  PET_RESTORE_EVENT,
  PET_STATE_EVENT,
  PET_STATE_REQUEST_EVENT,
  type PetSnapshot,
  type PetState,
} from "./pipState";
import { setAuxiliaryWindowVisibility } from "./windowVisibility";

const SINGLE_CLICK_DELAY = 280;
const DRAG_THRESHOLD = 4;

async function clampPetToWorkArea() {
  const petWindow = getCurrentWindow();
  const [position, size, monitor] = await Promise.all([
    petWindow.outerPosition(),
    petWindow.outerSize(),
    currentMonitor(),
  ]);
  if (!monitor) return;

  const workArea = monitor.workArea;
  const minX = workArea.position.x;
  const minY = workArea.position.y;
  const maxX = minX + workArea.size.width - size.width;
  const maxY = minY + workArea.size.height - size.height;
  const x = Math.min(Math.max(position.x, minX), Math.max(minX, maxX));
  const y = Math.min(Math.max(position.y, minY), Math.max(minY, maxY));
  if (x !== position.x || y !== position.y) {
    await petWindow.setPosition(new PhysicalPosition(x, y));
  }
}

function DanwoongPet({ state }: { state: PetState }) {
  const isRunning = state === "running" || state === "completed";
  const isCompleted = state === "completed";
  const legAngle = isCompleted ? 25 : isRunning ? 18 : 0;

  return (
    <svg className="danwoong-pet__art" aria-hidden="true" viewBox="0 0 46 42" fill="none">
      <circle cx="9" cy="7" r="5" fill="#16243A" />
      <circle cx="29" cy="7" r="5" fill="#16243A" />
      <ellipse cx="19" cy="18.5" rx="16" ry="13.5" fill="#16243A" />
      <ellipse cx="19.5" cy="22" rx="7.5" ry="5" fill="#F1E6D4" />
      <circle cx="9" cy="20" r="2" fill="#EFA57E" />
      <circle cx="31" cy="20" r="2" fill="#EFA57E" />
      <ellipse cx="20.5" cy="33.5" rx="11.5" ry="7.5" fill="#16243A" />
      <rect x="6" y="32" width="14" height="4" rx="2" transform={`rotate(${legAngle} 6 32)`} fill="#16243A" />
      <rect x="24" y="32" width="14" height="4" rx="2" transform={`rotate(${-legAngle} 24 32)`} fill="#16243A" />
      <g opacity={isRunning ? 1 : 0} fill="#72D7C4">
        <rect y={isCompleted ? 12 : 14} width={isCompleted ? 10 : 8} height="2" rx="1" />
        <rect y={isCompleted ? 19 : 21} width={isCompleted ? 15 : 12} height="2" rx="1" />
        <rect y="26" width="9" height="2" rx="1" opacity={isCompleted ? 1 : 0} />
      </g>
      <circle cx="40.5" cy="5.5" r="3.5" fill="#CFE7E1" opacity={isCompleted ? 1 : 0} />
    </svg>
  );
}

export default function PetWindow() {
  const [snapshot, setSnapshot] = useState<PetSnapshot>({ state: "running", progress: 0 });
  const pointerStart = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastClickAt = useRef(0);
  const singleClickTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void listen<PetSnapshot>(PET_STATE_EVENT, (event) => setSnapshot(event.payload)).then((unlisten) => {
      cleanup = unlisten;
      void emitTo("pip", PET_STATE_REQUEST_EVENT).catch(() => undefined);
    });
    return () => {
      cleanup?.();
      if (singleClickTimer.current) window.clearTimeout(singleClickTimer.current);
    };
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      void setAuxiliaryWindowVisibility("pip", false);
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else cleanup = unlisten;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const restoreCompact = async () => {
    await emitTo("pip", PET_RESTORE_EVENT);
  };

  const openMainWindow = async () => {
    const mainWindow = await TauriWindow.getByLabel("main");
    if (!mainWindow) return;
    await mainWindow.show();
    await mainWindow.unminimize();
    await mainWindow.setFocus();
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    pointerStart.current = { x: event.screenX, y: event.screenY };
    dragging.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragging.current) return;
    const distance = Math.hypot(
      event.screenX - pointerStart.current.x,
      event.screenY - pointerStart.current.y,
    );
    if (distance < DRAG_THRESHOLD) return;
    dragging.current = true;
    if (singleClickTimer.current) window.clearTimeout(singleClickTimer.current);
    void getCurrentWindow()
      .startDragging()
      .then(clampPetToWorkArea)
      .catch(() => undefined);
  };

  const handlePointerUp = () => {
    if (dragging.current) {
      dragging.current = false;
      return;
    }

    const now = Date.now();
    if (now - lastClickAt.current <= SINGLE_CLICK_DELAY) {
      lastClickAt.current = 0;
      if (singleClickTimer.current) window.clearTimeout(singleClickTimer.current);
      void openMainWindow();
      return;
    }

    lastClickAt.current = now;
    singleClickTimer.current = window.setTimeout(() => {
      lastClickAt.current = 0;
      void restoreCompact();
    }, SINGLE_CLICK_DELAY);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void restoreCompact();
  };

  return (
    <main className={`pet-window pet-window--${snapshot.state}`}>
      <button
        className="danwoong-pet"
        type="button"
        aria-label="단웅이. 한 번 클릭하면 PIP, 두 번 클릭하면 Main Study OS 열기"
        title="한 번 클릭: PIP · 두 번 클릭: Main"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        <DanwoongPet state={snapshot.state} />
      </button>
    </main>
  );
}
