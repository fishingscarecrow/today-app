import { handleCallback } from "@vercel/queue";
import {
  devicePath,
  mapStorageError,
  readPrivateJson,
  sendPush,
  writePrivateJson
} from "../../lib/push.js";

export default handleCallback(async message => {
  const deviceId = String(message?.deviceId || "");
  const reminderKey = String(message?.reminderKey || "");
  const scheduledAt = Number(message?.scheduledAt);

  if (!deviceId || !reminderKey || !Number.isFinite(scheduledAt)) return;

  const pathname = devicePath(deviceId);
  const config = await readPrivateJson(pathname);

  if (!config?.subscription || !Array.isArray(config.reminders)) return;

  const reminder = config.reminders.find(item =>
    item.key === reminderKey &&
    Number(item.at) === scheduledAt
  );

  if (!reminder || reminder.sentFor === scheduledAt) return;

  try {
    await sendPush(config.subscription, {
      title: "Today reminder",
      body: "Open Today to see your reminder.",
      tag: `today-reminder-${scheduledAt}-${reminderKey.slice(0, 24)}`,
      url: "./"
    });

    reminder.sentFor = scheduledAt;
    config.updatedAt = Date.now();
    await writePrivateJson(pathname, config);
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 0;

    if (statusCode === 404 || statusCode === 410) {
      config.subscription = null;
      config.updatedAt = Date.now();
      await writePrivateJson(pathname, config);
      return;
    }

    const mapped = mapStorageError(error);
    if (mapped) return;

    throw error;
  }
});
