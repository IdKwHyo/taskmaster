function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;").slice(0, 240);
}

export const runtime = "edge";

export function GET(request: Request) {
  const url = new URL(request.url);
  const title = escapeIcs(url.searchParams.get("title") || "Henry project review");
  const id = escapeIcs(url.searchParams.get("id") || "evt-henry-0818");
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Henry//Autonomous Workflow Prototype//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${id}@henry.prototype`,
    "DTSTAMP:20260813T050000Z",
    "DTSTART:20260818T083000Z",
    "DTEND:20260818T090000Z",
    `SUMMARY:${title}`,
    "DESCRIPTION:Created by Henry after human approval in prototype mode.",
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="henry-project-review.ics"',
      "Cache-Control": "no-store",
    },
  });
}
