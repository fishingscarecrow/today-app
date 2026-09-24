import crypto from "node:crypto";
import webpush from "web-push";
import { get, list, put } from "@vercel/blob";
import { send } from "@vercel/queue";

export const PUSH_TOPIC = "today-reminders";
export const QUEUE_MAX_SECONDS = 7 * 24 * 60 * 60;
const DEVICE_PREFIX = "today-push-devices/";

export function configureWebPush() {
  const privateKey = process.env.VERCEL_VAPID_PRIVATE_KEY;

  if (!privateKey) {
    const error = new Error("vapid_not_configured");
    error.code = "vapid_not_configured";
    throw error;
  }

  webpush.setVapidDetails(
    process.env.VERCEL_VAPID_SUBJECT || "https://github.com/fishingscarecrow/today-app",
    "BPqanrny4bDb0sAoBip7On2-v0TkTJt7pLMxhhViAUDugGJZAsSc0SweTXmS_yTatKTzf0k67VfBng0sg-M3YvU",
    privateKey
  );
}

export function validateDeviceId(deviceId) {
  return /^[a-f0-9]{36}$/.test(String(deviceId || ""));
}

export function devicePath(deviceId) {
  const hash = crypto.createHash("sha256").update(String(deviceId)).digest("hex");
  return `${DEVICE_PREFIX}${hash}.json`;
}

export async function readPrivateJson(pathname) {
  try {
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200) return null;
    const raw = await new Response(result.stream).text();
    return JSON.parse(raw);
  } catch (error) {
    const message = String(error?.message || error || "");

    if (
      message.includes("not found") ||
      message.includes("404") ||
      message.includes("NoSuchKey")
    ) {
      return null;
    }

    throw error;
  }
}

export async function writePrivateJson(pathname, value) {
  await put(pathname, JSON.stringify(value), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 0
  });
}

export function normalizeSubscription(subscription) {
  if (
    !subscription ||
    typeof subscription.endpoint !== "string" ||
    !subscription.keys ||
    typeof subscription.keys.p256dh !== "string" ||
    typeof subscription.keys.auth !== "string"
  ) {
    return null;
  }

  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth
    }
  };
}

export function normalizeReminders(reminders) {
  if (!Array.isArray(reminders)) return [];

  const now = Date.now();
  const maxFuture = now + 366 * 24 * 60 * 60 * 1000;

  return reminders
    .filter(item =>
      item &&
      typeof item.key === "string" &&
      item.key.length <= 250 &&
      Number.isFinite(Number(item.at))
    )
    .map(item => ({ key:item.key, at:Number(item.at) }))
    .filter(item => item.at > now - 60 * 1000 && item.at <= maxFuture)
    .slice(0, 500);
}

export async function enqueueEligibleReminders(config) {
  if (!config?.deviceId || !Array.isArray(config.reminders)) return config;

  const now = Date.now();

  for (const reminder of config.reminders) {
    if (reminder.sentFor === reminder.at) continue;
    if (reminder.queuedFor === reminder.at) continue;

    const delaySeconds = Math.max(0, Math.floor((reminder.at - now) / 1000));
    if (delaySeconds > QUEUE_MAX_SECONDS - 60) continue;

    const idempotencyKey = crypto
      .createHash("sha256")
      .update(`${config.deviceId}|${reminder.key}|${reminder.at}`)
      .digest("hex");

    await send(
      PUSH_TOPIC,
      {
        deviceId: config.deviceId,
        reminderKey: reminder.key,
        scheduledAt: reminder.at
      },
      {
        delaySeconds,
        retentionSeconds: QUEUE_MAX_SECONDS,
        idempotencyKey
      }
    );

    reminder.queuedFor = reminder.at;
  }

  return config;
}

export async function listDeviceBlobs() {
  const blobs = [];
  let cursor;

  do {
    const result = await list({
      prefix: DEVICE_PREFIX,
      limit: 250,
      cursor
    });

    blobs.push(...result.blobs);
    cursor = result.cursor;
  } while (cursor);

  return blobs;
}

export async function sendPush(subscription, payload) {
  configureWebPush();

  return webpush.sendNotification(
    subscription,
    JSON.stringify(payload),
    { TTL: 60 * 60 }
  );
}

export function mapStorageError(error) {
  const message = String(error?.message || error || "");

  if (error?.code === "vapid_not_configured") {
    return "vapid_not_configured";
  }

  if (
    message.includes("BLOB_READ_WRITE_TOKEN") ||
    message.includes("blob") ||
    message.includes("store") ||
    message.includes("token")
  ) {
    return "storage_not_configured";
  }

  return null;
}
