import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { STUDY_DATA_CHANGED_EVENT } from "../../data/studyData";
import type { CalendarRangeData } from "./service";
import { loadCalendarRange } from "./service";
import {
  assignmentDateKey,
  calendarRowsForDate,
  dateFromKey,
  localDateKey,
  monthDays,
  monthRange,
  occurrenceDateKeys,
  upcomingAssignmentRows,
  type CalendarRow,
} from "./model";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const EMPTY_DATA: CalendarRangeData = { occurrences: [], assignments: [] };

function formatShortDate(dateKey: string) {
  const date = dateFromKey(dateKey);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatRowMeta(row: CalendarRow, todayKey: string, selectedAgenda: boolean) {
  if (row.kind === "occurrence") {
    if (row.timeKind === "date") return "종일";
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(row.sortAt));
  }
  if (selectedAgenda) return row.dateKey === todayKey ? "오늘" : "마감";
  const days = Math.round((dateFromKey(row.dateKey).getTime() - dateFromKey(todayKey).getTime()) / 86_400_000);
  return days === 0 ? "오늘" : `D-${days}`;
}

export default function CalendarWindow() {
  const todayKey = localDateKey(new Date());
  const today = dateFromKey(todayKey);
  const [viewMonth, setViewMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [data, setData] = useState<CalendarRangeData>(EMPTY_DATA);
  const [error, setError] = useState(false);
  const requestId = useRef(0);
  const range = useMemo(
    () => monthRange(viewMonth.getFullYear(), viewMonth.getMonth()),
    [viewMonth],
  );

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      const next = await loadCalendarRange(range);
      if (currentRequest !== requestId.current) return;
      setData(next);
      setError(false);
    } catch (reason) {
      if (currentRequest !== requestId.current) return;
      console.error("Calendar data load failed", reason);
      setError(true);
    }
  }, [range]);

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

  const cells = monthDays(viewMonth.getFullYear(), viewMonth.getMonth());
  const itemDates = useMemo(() => {
    const result = new Map<string, string[]>();
    const add = (dateKey: string, title: string) => {
      const titles = result.get(dateKey) ?? [];
      titles.push(title);
      result.set(dateKey, titles);
    };
    for (const occurrence of data.occurrences) {
      for (const dateKey of occurrenceDateKeys(occurrence)) add(dateKey, occurrence.title);
    }
    for (const assignment of data.assignments) {
      const dateKey = assignmentDateKey(assignment);
      if (dateKey) add(dateKey, assignment.title);
    }
    return result;
  }, [data]);
  const selectedRows = calendarRowsForDate(selectedDate, data.occurrences, data.assignments);
  const selectedAgenda = selectedRows.length > 0;
  const availableRows = selectedAgenda
    ? selectedRows
    : upcomingAssignmentRows(selectedDate, data.assignments);
  const rows = availableRows.slice(0, 3);
  const selected = dateFromKey(selectedDate);
  const baseSectionTitle = selectedAgenda
    ? `${selected.getMonth() + 1}월 ${selected.getDate()}일 일정`
    : "다가오는 마감";
  const sectionTitle = availableRows.length > rows.length
    ? `${baseSectionTitle} · +${availableRows.length - rows.length}`
    : baseSectionTitle;

  const moveMonth = (offset: number) => {
    const next = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + offset, 1);
    setViewMonth(next);
    setSelectedDate(
      next.getFullYear() === today.getFullYear() && next.getMonth() === today.getMonth()
        ? todayKey
        : localDateKey(next),
    );
  };

  return (
    <main className="calendar-window" data-node-id="44:333">
      <header className="calendar-header" data-tauri-drag-region>
        <h1>{viewMonth.getMonth() + 1}월</h1>
        <span>{viewMonth.getFullYear()}</span>
        <div className="calendar-month-actions">
          <button type="button" aria-label="이전 달" onClick={() => moveMonth(-1)}>‹</button>
          <button type="button" aria-label="다음 달" onClick={() => moveMonth(1)}>›</button>
        </div>
      </header>

      <div className="calendar-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>

      <div className={`calendar-dates calendar-dates--${Math.ceil(cells.length / 7)}-rows`} role="grid">
        {cells.map((cell, index) => cell ? (
          <button
            type="button"
            role="gridcell"
            className={[
              "calendar-date",
              cell.dateKey === selectedDate ? "calendar-date--selected" : "",
              itemDates.has(cell.dateKey) ? "calendar-date--has-items" : "",
            ].filter(Boolean).join(" ")}
            aria-label={`${cell.dateKey}${itemDates.has(cell.dateKey) ? `, ${itemDates.get(cell.dateKey)?.join(", ")}` : ""}`}
            aria-selected={cell.dateKey === selectedDate}
            key={cell.dateKey}
            onClick={() => setSelectedDate(cell.dateKey)}
          >
            <span>{cell.day}</span>
            {itemDates.has(cell.dateKey) && <i className="calendar-date__marker" aria-hidden="true" />}
          </button>
        ) : <span className="calendar-date calendar-date--empty" aria-hidden="true" key={`empty-${index}`} />)}
      </div>

      <section className="calendar-upcoming" aria-labelledby="calendar-upcoming-heading">
        <h2 id="calendar-upcoming-heading">{sectionTitle}</h2>
        {error ? (
          <p className="calendar-empty" role="status">일정을 불러오지 못했어요.</p>
        ) : rows.length === 0 ? (
          <p className="calendar-empty">표시할 일정이 없어요.</p>
        ) : (
          <ol>
            {rows.map((row) => (
              <li key={`${row.kind}:${row.id}`} data-kind={row.kind}>
                <time>{formatShortDate(row.dateKey)}</time>
                <strong>{row.title}</strong>
                <small>{formatRowMeta(row, todayKey, selectedAgenda)}</small>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
