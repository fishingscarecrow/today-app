import {
  mapStorageError,
  normalizeSubscription,
  sendPush,
  validateDeviceId
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

    if (!validateDeviceId(deviceId) || !subscription) {
      return response.status(400).json({ error: "invalid_request" });
    }

    await sendPush(subscription, {
      title: "Today",
      body: "Push notifications are working.",
      tag: `today-test-${Date.now()}`,
      url: "./"
    });

    return response.status(200).json({ ok: true });
  } catch (error) {
    const mapped = mapStorageError(error);
    if (mapped) return response.status(503).json({ error: mapped });

    const statusCode = Number(error?.statusCode) || 500;

    return response.status(statusCode === 404 || statusCode === 410 ? 410 : 500).json({
      error: statusCode === 404 || statusCode === 410
        ? "subscription_expired"
        : "push_test_failed"
    });
  }
}
