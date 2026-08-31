import { createMission, runPrototypeAction, type PrototypeAction } from "@/lib/henry-prototype";
import { runHenryCommand } from "@/lib/henry-command";
import { runCloudAction } from "@/lib/henry-cloud";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const action = (await request.json()) as PrototypeAction;
    if (action.type === "command") {
      const result = runHenryCommand(action.query, action.mission);
      return Response.json(result);
    }
    const cloudUrl = process.env.HENRY_CLOUD_API_URL;
    const usesCloud = Boolean(cloudUrl) && (action.type === "create" || ("mission" in action && action.mission.backend === "cloud"));
    if (usesCloud && cloudUrl) {
      try {
        const mission = await runCloudAction({
          baseUrl: cloudUrl,
          apiKey: process.env.HENRY_CLOUD_API_KEY,
          ownerId: process.env.HENRY_CLOUD_OWNER_ID,
        }, action);
        return Response.json({ mission, source: "cloud" }, { status: action.type === "create" ? 202 : 200 });
      } catch (error) {
        if (action.type !== "create") throw error;
        const mission = createMission(action.outcome);
        mission.events[0].detail = "Cloud engine unavailable · LOCAL FALLBACK";
        return Response.json({ mission, source: "local-fallback" }, { status: 202 });
      }
    }
    const mission = runPrototypeAction(action);
    return Response.json({ mission, source: "local" }, { status: action.type === "create" ? 202 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prototype runner failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
