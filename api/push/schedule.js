import {
  devicePath,
  enqueueEligibleReminders,
  mapStorageError,
  normalizeReminders,
  normalizeSubscription,
  readPrivateJson,
  validateDeviceId,
  writePrivateJson
} from "../../lib/push.js";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const deviceId = String(body?.deviceId || "");
    const subscription = normalizeSubscription(body?.subscription);
    const reminders = normalizeReminders(body?.reminders);

    if (!validateDeviceId(deviceId) || !subscription) {
      return response.status(400).json({ error: "invalid_request" });
    }

    const pathname = devicePath(deviceId);
    const previous = await readPrivateJson(pathname);
    const previousByKey = new Map((previous?.reminders || []).map(item => [item.key, item]));

    const config = {
      version: 1,
      deviceId,
      subscription,
      updatedAt: Date.now(),
      reminders: reminders.map(reminder => {
        const old = previousByKey.get(reminder.key);
        return {
          ...reminder,
          queuedFor: old?.at === reminder.at ? old?.queuedFor || null : null,
          sentFor: old?.at === reminder.at ? old?.sentFor || null : null
        };
      })
    };

    await enqueueEligibleReminders(config);
    await writePrivateJson(pathname, config);

    return response.status(200).json({ ok: true, reminders: config.reminders.length });
  } catch (error) {
    const mapped = mapStorageError(error);
    if (mapped) return response.status(503).json({ error: mapped });

    console.error("Today push schedule failed", error);
    return response.status(500).json({ error: "push_schedule_failed" });
  }
}
