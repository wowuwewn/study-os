import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { STUDY_DATA_CHANGED_EVENT } from "../../data/studyData";
import { getLocalWeekRange } from "./model";
import { loadWeekSurface, type WeekSurfaceData } from "./service";

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

export default function WeekView() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [data, setData] = useState<WeekSurfaceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await loadWeekSurface(anchor));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [anchor]);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 30_000);
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void listen(STUDY_DATA_CHANGED_EVENT, () => void reload()).then((unlisten) => {
      if (cancelled) unlisten();
      else cleanup = unlisten;
    });
    return () => {
      cancelled = true;
      cleanup?.();
      window.clearInterval(timer);
    };
  }, [reload]);

  const moveWeek = (offset: number) => setAnchor((current) => {
    const next = new Date(current);
    next.setDate(next.getDate() + offset * 7);
    return next;
  });
  const range = getLocalWeekRange(anchor);
  const rangeLabel = `${new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(range.start)} – ${new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(range.end.getTime() - 1))}`;
  const maxMinutes = Math.max(1, ...(data?.stats.days.map((day) => day.minutes) ?? [1]));

  return (
    <div className="week-surface">
      <section className="week-schedule" aria-labelledby="week-heading">
        <header className="week-header">
          <div>
            <h1 id="week-heading">이번 주</h1>
            <span>{rangeLabel}</span>
          </div>
          <div className="week-navigation" aria-label="주간 이동">
            <button type="button" onClick={() => moveWeek(-1)} aria-label="이전 주">‹</button>
            <button type="button" onClick={() => setAnchor(new Date())}>오늘</button>
            <button type="button" onClick={() => moveWeek(1)} aria-label="다음 주">›</button>
          </div>
        </header>
        <ol className="week-days">
          {(data?.days ?? []).map((day) => (
            <li className={day.isToday ? "week-day week-day--today" : "week-day"} key={day.dateKey}>
              <header>
                <strong>{new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(day.date)}</strong>
                <time dateTime={day.dateKey}>{day.date.getDate()}</time>
              </header>
              <ul>
                {day.items.length === 0 && <li className="week-item week-item--empty">일정 없음</li>}
                {day.items.map((item) => (
                  <li className={`week-item week-item--${item.kind}`} key={item.id}>
                    <time>{item.timeLabel}</time>
                    <span>{item.title}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <aside className="focus-stats" aria-labelledby="focus-stats-heading">
        <header>
          <span>FOCUS</span>
          <h2 id="focus-stats-heading">집중 기록</h2>
        </header>
        <dl className="focus-summary">
          <div><dt>오늘</dt><dd>{formatMinutes(data?.stats.todayMinutes ?? 0)}</dd></div>
          <div><dt>이번 주</dt><dd>{formatMinutes(data?.stats.weekMinutes ?? 0)}</dd></div>
          <div><dt>세션</dt><dd>{data?.stats.weekSessionCount ?? 0}회</dd></div>
        </dl>
        <div className="focus-week-bars" aria-label="월요일부터 일요일까지 집중 시간">
          {(data?.stats.days ?? []).map((day) => (
            <div key={day.dateKey}>
              <span className="focus-bar-value">{day.minutes}</span>
              <span className="focus-bar-track"><i style={{ height: `${Math.max(3, day.minutes / maxMinutes * 100)}%` }} /></span>
              <span>{day.label}</span>
            </div>
          ))}
        </div>
        <p className="focus-stats-note">일시정지 시간은 기록에서 제외돼요.</p>
      </aside>
      {error && <p className="surface-error" role="alert">주간 데이터를 불러오지 못했습니다.</p>}
    </div>
  );
}
