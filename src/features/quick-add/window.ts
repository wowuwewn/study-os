import { emitTo } from "@tauri-apps/api/event";
import { Window } from "@tauri-apps/api/window";

export const QUICK_ADD_OPENED_EVENT = "study-os-quick-add-opened";

export async function showQuickAddWindow(): Promise<void> {
  const quickAdd = await Window.getByLabel("quick-add");
  if (!quickAdd) throw new Error("Quick Add window is unavailable");
  await quickAdd.unminimize();
  await quickAdd.show();
  await quickAdd.setFocus();
  await emitTo("quick-add", QUICK_ADD_OPENED_EVENT);
}
