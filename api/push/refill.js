import {
  enqueueEligibleReminders,
  listDeviceBlobs,
  mapStorageError,
  readPrivateJson,
  writePrivateJson
} from "../../lib/push.js";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const blobs = await listDeviceBlobs();
    let updated = 0;

    for (const blob of blobs) {
      const config = await readPrivateJson(blob.pathname);

      if (!config?.subscription || !Array.isArray(config.reminders)) continue;

      const before = JSON.stringify(config.reminders);
      await enqueueEligibleReminders(config);
      const after = JSON.stringify(config.reminders);

      if (before !== after) {
        config.updatedAt = Date.now();
        await writePrivateJson(blob.pathname, config);
        updated += 1;
      }
    }

    return response.status(200).json({
      ok: true,
      checked: blobs.length,
      updated
    });
  } catch (error) {
    const mapped = mapStorageError(error);
    if (mapped) return response.status(503).json({ error: mapped });

    console.error("Today push refill failed", error);
    return response.status(500).json({ error: "push_refill_failed" });
  }
}
