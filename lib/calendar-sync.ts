export type CalendarSyncState = "live" | "demo" | "error";

export type CalendarDay = {
  date: string;
  day: string;
  dateLabel: string;
};

export type CalendarEventBlock = {
  id: string;
  title: string;
  dayIndex: number;
  startMinute: number;
  endMinute: number;
  source: "google" | "demo";
};

export type CalendarCandidate = {
  id: string;
  label: string;
  dayIndex: number;
  startMinute: number;
  endMinute: number;
  available: boolean;
  selected: boolean;
  score: number;
  reason: string;
};

export type CalendarSnapshot = {
  syncState: CalendarSyncState;
  account: string;
  calendarName: string;
  fetchedAt: string;
  latencyMs: number;
  rangeLabel: string;
  days: CalendarDay[];
  events: CalendarEventBlock[];
  candidates: CalendarCandidate[];
  warning?: string;
};

type GoogleCalendarEvent = {
  id?: string;
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

const TIME_ZONE = "Asia/Bangkok";
const DAY_MS = 86_400_000;
const CANDIDATE_SLOTS = [
  { dayIndex: 1, startMinute: 15 * 60 + 30, score: 96, reason: "Best buffer after existing commitments" },
  { dayIndex: 2, startMinute: 9 * 60 + 30, score: 82, reason: "Available, but creates a tighter morning" },
  { dayIndex: 3, startMinute: 14 * 60, score: 76, reason: "Available, but later in the requested window" },
];

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

export function nextWorkWeek(anchor = new Date()) {
  const utcDay = anchor.getUTCDay();
  const daysUntilMonday = utcDay === 0 ? 1 : 8 - utcDay;
  const monday = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() + daysUntilMonday));
  const dayName = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" });
  const dateLabel = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" });
  return Array.from({ length: 5 }, (_, index) => {
    const date = addDays(monday, index);
    return { date: dateKey(date), day: dayName.format(date), dateLabel: dateLabel.format(date) };
  });
}

function localParts(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    minute: Number(pick("hour")) * 60 + Number(pick("minute")),
  };
}

export function normalizeGoogleEvents(items: GoogleCalendarEvent[], days: CalendarDay[]): CalendarEventBlock[] {
  return items.flatMap((item, index) => {
    const startValue = item.start?.dateTime;
    const endValue = item.end?.dateTime;
    if (!startValue || !endValue) return [];
    const start = localParts(startValue);
    const end = localParts(endValue);
    const dayIndex = days.findIndex((day) => day.date === start.date);
    if (dayIndex < 0) return [];
    return [{
      id: item.id ?? `google-${index}`,
      title: item.summary?.trim() || "Busy",
      dayIndex,
      startMinute: start.minute,
      endMinute: Math.max(end.minute, start.minute + 30),
      source: "google" as const,
    }];
  });
}

function candidatesFor(events: CalendarEventBlock[]): CalendarCandidate[] {
  let selected = false;
  return CANDIDATE_SLOTS.map((slot) => {
    const endMinute = slot.startMinute + 30;
    const available = !events.some((event) => event.dayIndex === slot.dayIndex && slot.startMinute < event.endMinute && endMinute > event.startMinute);
    const isSelected = available && !selected;
    if (isSelected) selected = true;
    return {
      ...slot,
      id: `candidate-${slot.dayIndex}-${slot.startMinute}`,
      label: `${["Mon", "Tue", "Wed", "Thu", "Fri"][slot.dayIndex]} ${String(Math.floor(slot.startMinute / 60)).padStart(2, "0")}:${String(slot.startMinute % 60).padStart(2, "0")}`,
      endMinute,
      available,
      selected: isSelected,
      reason: available ? slot.reason : "Conflicts with an existing Google Calendar event",
    };
  });
}

export function buildDemoCalendarSnapshot(anchor = new Date(), warning?: string): CalendarSnapshot {
  const days = nextWorkWeek(anchor);
  const events: CalendarEventBlock[] = [
    { id: "demo-standup", title: "Team stand-up", dayIndex: 0, startMinute: 9 * 60 + 30, endMinute: 10 * 60, source: "demo" },
    { id: "demo-product", title: "Product sync", dayIndex: 1, startMinute: 14 * 60, endMinute: 15 * 60, source: "demo" },
    { id: "demo-design", title: "Design review", dayIndex: 2, startMinute: 10 * 60 + 30, endMinute: 11 * 60 + 30, source: "demo" },
    { id: "demo-focus", title: "Focus block", dayIndex: 4, startMinute: 13 * 60, endMinute: 14 * 60 + 30, source: "demo" },
  ];
  return {
    syncState: warning ? "error" : "demo",
    account: "Google Calendar demo",
    calendarName: "Primary calendar",
    fetchedAt: new Date().toISOString(),
    latencyMs: 71,
    rangeLabel: `${days[0].dateLabel}–${days[4].dateLabel}`,
    days,
    events,
    candidates: candidatesFor(events),
    warning,
  };
}

export function buildLiveCalendarSnapshot(items: GoogleCalendarEvent[], account: string, latencyMs: number, anchor = new Date()): CalendarSnapshot {
  const days = nextWorkWeek(anchor);
  const events = normalizeGoogleEvents(items, days);
  return {
    syncState: "live",
    account,
    calendarName: "Primary calendar",
    fetchedAt: new Date().toISOString(),
    latencyMs,
    rangeLabel: `${days[0].dateLabel}–${days[4].dateLabel}`,
    days,
    events,
    candidates: candidatesFor(events),
  };
}

export function calendarQueryWindow(anchor = new Date()) {
  const days = nextWorkWeek(anchor);
  const start = new Date(`${days[0].date}T00:00:00+07:00`);
  const end = new Date(`${dateKey(addDays(new Date(`${days[4].date}T00:00:00Z`), 1))}T00:00:00+07:00`);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}
