import assert from "node:assert/strict";
import test from "node:test";
import { buildDemoCalendarSnapshot, buildLiveCalendarSnapshot, calendarQueryWindow, nextWorkWeek } from "../lib/calendar-sync.ts";

test("nextWorkWeek returns five consecutive weekdays", () => {
  const days = nextWorkWeek(new Date("2026-08-16T04:00:00Z"));
  assert.deepEqual(days.map((day) => day.date), ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"]);
});

test("demo calendar provides inspectable events and a selected free candidate", () => {
  const snapshot = buildDemoCalendarSnapshot(new Date("2026-08-16T04:00:00Z"));
  assert.equal(snapshot.syncState, "demo");
  assert.equal(snapshot.days.length, 5);
  assert.ok(snapshot.events.length >= 3);
  assert.equal(snapshot.candidates.filter((slot) => slot.selected).length, 1);
});

test("live calendar blocks candidates that overlap Google events", () => {
  const snapshot = buildLiveCalendarSnapshot([
    {
      id: "busy",
      summary: "Customer call",
      start: { dateTime: "2026-08-18T15:15:00+07:00" },
      end: { dateTime: "2026-08-18T16:15:00+07:00" },
    },
  ], "graphic@example.com", 124, new Date("2026-08-16T04:00:00Z"));
  assert.equal(snapshot.syncState, "live");
  assert.equal(snapshot.candidates[0].available, false);
  assert.equal(snapshot.candidates[1].selected, true);
});

test("calendar query window covers the next workweek", () => {
  const range = calendarQueryWindow(new Date("2026-08-16T04:00:00Z"));
  assert.equal(range.timeMin, "2026-08-16T17:00:00.000Z");
  assert.equal(range.timeMax, "2026-08-21T17:00:00.000Z");
});
