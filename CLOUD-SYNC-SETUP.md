# Today Cloud Sync v1

Cloud Sync is built into Today.

## One-time Vercel setup

1. Open the Today project in Vercel.
2. Open Storage.
3. Create/connect a Vercel Blob store to this project.
4. Choose private storage.
5. Redeploy if Vercel does not redeploy automatically.
6. In Today, open Settings -> Cloud Sync -> Create sync.
7. Copy the generated sync code.
8. On the second device, open Settings -> Cloud Sync -> Connect code.

The sync code never leaves the browser. Today derives a sync ID from it and encrypts planner data with AES-GCM before upload.

Anyone with the sync code can decrypt the cloud copy, so keep it private.
