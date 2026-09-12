export type SessionState = "idle" | "running" | "paused" | "completing";
export type PetState = "idle" | "running" | "paused" | "completed";

export type PetSnapshot = {
  state: PetState;
  progress: number;
};

export const PET_STATE_EVENT = "study-os-pet-state";
export const PET_STATE_REQUEST_EVENT = "study-os-pet-state-request";
export const PET_RESTORE_EVENT = "study-os-pet-restore";

export function toPetState(state: SessionState): PetState {
  return state === "completing" ? "completed" : state;
}
