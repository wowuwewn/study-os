export type QuickAddEntityType = "study-task" | "event";

export type QuickAddTypeOverride = QuickAddEntityType | null;

export type QuickAddParseResult = {
  rawInput: string;
  entityType: QuickAddEntityType;
  title: string;
  estimatedMinutes: number | null;
  dueAt: string | null;
  plannedStartAt: string | null;
  startAt: string | null;
  endAt: string | null;
  dateLabel: string | null;
  timeLabel: string | null;
  hasDeadline: boolean;
  valid: boolean;
  error: string | null;
};

export type QuickAddParseOptions = {
  now?: Date;
  typeOverride?: QuickAddTypeOverride;
};

export type QuickAddSaveResult = {
  id: string;
  entityType: QuickAddEntityType;
  courseId: string | null;
};
