import { get, put } from "@vercel/blob";

const ID_PATTERN = /^[a-f0-9]{48}$/;
const MAX_PAYLOAD_BYTES = 2500000;

function commonHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function blobPath(syncId) {
  return `today-sync/${syncId}.json`;
}

export default async function handler(request, response) {
  commonHeaders(response);

  if (request.method === "GET") {
    const syncId = String(request.query?.id || "");

    if (!ID_PATTERN.test(syncId)) {
      return response.status(400).json({ error: "invalid_sync_id" });
    }

    try {
      const result = await get(blobPath(syncId), { access: "private" });

      if (!result || result.statusCode !== 200) {
        return response.status(404).json({ error: "not_found" });
      }

      const raw = await new Response(result.stream).text();
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      return response.status(200).send(raw);
    } catch (error) {
      const message = String(error?.message || error || "");

      if (
        message.includes("BLOB_READ_WRITE_TOKEN") ||
        message.toLowerCase().includes("store") ||
        message.toLowerCase().includes("token")
      ) {
        return response.status(503).json({ error: "storage_not_configured" });
      }

      if (message.toLowerCase().includes("not found") || message.includes("404")) {
        return response.status(404).json({ error: "not_found" });
      }

      console.error("Today sync read failed", error);
      return response.status(500).json({ error: "sync_read_failed" });
    }
  }

  if (request.method === "POST") {
    try {
      const body =
        typeof request.body === "string"
          ? JSON.parse(request.body)
          : request.body;

      const syncId = String(body?.syncId || "");
      const payload = body?.payload;

      if (!ID_PATTERN.test(syncId)) {
        return response.status(400).json({ error: "invalid_sync_id" });
      }

      if (
        !payload ||
        payload.version !== 1 ||
        typeof payload.iv !== "string" ||
        typeof payload.cipher !== "string" ||
        typeof payload.updatedAt !== "number" ||
        typeof payload.deviceId !== "string"
      ) {
        return response.status(400).json({ error: "invalid_payload" });
      }

      const raw = JSON.stringify({ payload });

      if (Buffer.byteLength(raw, "utf8") > MAX_PAYLOAD_BYTES) {
        return response.status(413).json({ error: "payload_too_large" });
      }

      await put(blobPath(syncId), raw, {
        access: "private",
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: "application/json",
        cacheControlMaxAge: 0
      });

      return response.status(200).json({
        ok: true,
        updatedAt: payload.updatedAt
      });
    } catch (error) {
      const message = String(error?.message || error || "");

      if (
        message.includes("BLOB_READ_WRITE_TOKEN") ||
        message.toLowerCase().includes("store") ||
        message.toLowerCase().includes("token")
      ) {
        return response.status(503).json({ error: "storage_not_configured" });
      }

      console.error("Today sync write failed", error);
      return response.status(500).json({ error: "sync_write_failed" });
    }
  }

  response.setHeader("Allow", "GET, POST");
  return response.status(405).json({ error: "method_not_allowed" });
}
