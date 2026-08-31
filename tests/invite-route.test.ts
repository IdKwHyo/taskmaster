import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/invite/route.ts";

test("invite route produces an importable calendar artifact", async () => {
  const response = GET(new Request("https://henry.test/api/invite?title=Project%20review&id=evt-204-0818"));
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/calendar/);
  assert.match(response.headers.get("content-disposition") ?? "", /henry-project-review\.ics/);
  assert.match(body, /BEGIN:VCALENDAR/);
  assert.match(body, /SUMMARY:Project review/);
  assert.match(body, /STATUS:CONFIRMED/);
});

test("invite route escapes user-controlled ICS fields", async () => {
  const response = GET(new Request("https://henry.test/api/invite?title=Review%2C%20team%3Bnow&id=safe"));
  const body = await response.text();
  assert.match(body, /SUMMARY:Review\\, team\\;now/);
});
