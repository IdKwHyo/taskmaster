import { CalendarCheck2, MailCheck, SearchCheck } from "lucide-react";

export type MissionStep = {
  id: string;
  label: string;
  state: "done" | "active" | "waiting" | "locked";
  icon: "plan" | "calendar" | "message" | "wait" | "approval" | "done";
  x: number;
  y: number;
};

export type Mission = { title: string; steps: MissionStep[] };

export const primaryMission: Mission = {
  title: "Coordinate a 30-min project review with A",
  steps: [
    { id: "plan", label: "Plan outcome", state: "done", icon: "plan", x: 16, y: 38 },
    { id: "calendar", label: "Check calendar", state: "done", icon: "calendar", x: 240, y: 38 },
    { id: "message", label: "Message A", state: "done", icon: "message", x: 468, y: 38 },
    { id: "wait", label: "Await reply", state: "active", icon: "wait", x: 590, y: 142 },
    { id: "approval", label: "Get approval", state: "locked", icon: "approval", x: 428, y: 214 },
    { id: "done", label: "Book & confirm", state: "locked", icon: "done", x: 182, y: 214 },
  ],
};

export const backgroundMissions = [
  { id: "m-198", title: "Prepare tomorrow's morning briefing", status: "SCHEDULED", detail: "08:45:00 ICT", icon: CalendarCheck2, tone: "bg-cyan-400/[0.06] text-cyan-300" },
  { id: "m-201", title: "Track Google ADK submission updates", status: "WAITING_EXTERNAL", detail: "signal ext-02", icon: SearchCheck, tone: "bg-blue-400/[0.06] text-blue-300" },
  { id: "m-203", title: "Follow up on unanswered project email", status: "RUNNING", detail: "step 02/04", icon: MailCheck, tone: "bg-emerald-400/[0.06] text-emerald-300" },
];

export const executionEvents = [
  { title: "Requested A's availability", time: "11:21:14.083 UTC", detail: "discord.send · 200 OK · 118ms", dot: "bg-cyan-400" },
  { title: "Found three conflict-free windows", time: "11:20:51.441 UTC", detail: "calendar.query · 200 OK · 124ms", dot: "bg-cyan-400" },
  { title: "Created and persisted workflow plan", time: "11:19:09.812 UTC", detail: "gemini-3.5-flash · 1,842 tok", dot: "bg-emerald-400" },
  { title: "Outcome accepted from dashboard", time: "11:19:04.222 UTC", detail: "POST /missions · 202 ACCEPTED", dot: "bg-slate-500" },
];
