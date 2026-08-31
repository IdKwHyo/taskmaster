import { buildDemoCalendarSnapshot, buildLiveCalendarSnapshot, calendarQueryWindow } from "@/lib/calendar-sync";

export const runtime = "edge";
export const dynamic = "force-dynamic";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken() {
  const directToken = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  if (directToken) return directToken;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`OAuth refresh failed with ${response.status}`);
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("OAuth refresh did not return an access token");
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

export async function GET() {
  const startedAt = performance.now();
  try {
    const token = await accessToken();
    if (!token) {
      return Response.json(buildDemoCalendarSnapshot(), { headers: { "Cache-Control": "no-store" } });
    }

    const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
    const account = process.env.GOOGLE_CALENDAR_ACCOUNT || "Connected Google account";
    const { timeMin, timeMax } = calendarQueryWindow();
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "50",
    });
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Google Calendar returned ${response.status}`);
    const payload = await response.json() as { items?: Array<{ id?: string; summary?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } }> };
    const snapshot = buildLiveCalendarSnapshot(payload.items ?? [], account, Math.max(1, Math.round(performance.now() - startedAt)));
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const warning = error instanceof Error ? error.message : "Google Calendar sync failed";
    return Response.json(buildDemoCalendarSnapshot(new Date(), warning), { headers: { "Cache-Control": "no-store" } });
  }
}
