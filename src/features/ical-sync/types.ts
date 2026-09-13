export type IcalConnectionStatus = {
  connected: boolean;
  status: "needs_configuration" | "idle" | "syncing" | "ok" | "error";
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
};

export type IcalDiagnostics = {
  calendars: number;
  vevents: number;
  vtodos: number;
  totalItems: number;
  dateValues: number;
  dateTimeValues: number;
  events: number;
  assignments: number;
  recurringRules: number;
  scheduleExceptions: number;
  cancellations: number;
  unsupported: number;
  propertyNames: string[];
  componentCounts: Record<string, number>;
  propertyCounts: Record<string, number>;
  unsupportedReasons: Record<string, number>;
  recurrenceShapes: Record<string, number>;
};

export type IcalSyncResult = {
  notModified: boolean;
  generation: number;
  inserted: number;
  updated: number;
  unchanged: number;
  diagnostics: IcalDiagnostics;
};
