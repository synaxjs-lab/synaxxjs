# SYNAX Share Easy — send a file with one link

A standalone mobile-first site for sharing large files with a short workflow:

1. Sender selects files and taps **Create share link**.
2. Sender taps **Share link** and chooses WhatsApp, Messages, or another app.
3. Recipient taps the link and taps **Receive files**. Transfer starts automatically after the direct connection opens.

The project uses WebRTC DataChannel to send file bytes directly between two browsers. Cloudflare Worker + Durable Object are used only for temporary connection signaling (offer/answer/ICE metadata). No file bytes are uploaded to Cloudflare, Supabase, or a storage bucket.

## Important limits

- This is **not unlimited cloud storage**. No file is stored in the cloud, but sender/receiver device storage, browser support, bandwidth, and connection duration still limit transfers.
- Both devices must be online and keep the page open during the transfer.
- Public STUN servers help establish a direct connection, but some corporate, carrier, or restrictive networks require a TURN relay. This version does not include a paid relay and may fail on such networks.
- The receiver saves files in browser private storage (OPFS) where supported, then taps **Download file**. Browser storage quota can still restrict a file. If OPFS is unavailable, this version only uses an in-memory fallback for files up to 128 MiB and recommends modern Chrome/Edge for larger files.
- Share links are bearer links: anyone who obtains the link may attempt to join while the room is active. Share only with the intended recipient. The recipient has to tap “Receive files” before a transfer begins.
- Signaling rooms expire after 12 hours; the service does not store or relay file bytes.

## Deploy as one Cloudflare Worker with static assets

This is now a Worker + Durable Object project, not a Pages-only static upload. Cloudflare Workers Builds can deploy it from GitHub.

1. Create an **empty GitHub repository** named `synax-share-easy` under your account or organization.
2. Extract this ZIP and open PowerShell in the extracted `SYNAX-SHARE-EASY` folder.
3. Push the source:

```powershell
git init
git add -A
git commit -m "Create simple SYNAX Share site"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/synax-share-easy.git
git push -u origin main
```

4. In Cloudflare Dashboard, go to **Workers & Pages → Create → Connect to Git** (Workers Builds) and select `synax-share-easy`.
5. Set the root directory to the repository root. Leave the Build command blank. Set the Deploy command to `npx wrangler deploy`. The project includes `wrangler.jsonc`, the `public/` asset directory, the Durable Object class, and the migration.
6. Deploy. After the first deployment, test `/health` (it should return JSON with `ok: true`) and the main website. Connect a custom domain such as `share.synax.online` in the Worker settings if desired.

Once GitHub is connected, future changes use only:

```powershell
git add -A
git commit -m "Improve SYNAX Share"
git push origin main
```

## Manual test checklist

- Sender chooses a small file, creates link, and shares it to a second device.
- Receiver opens the link, taps Receive files, sees progress, then can download the result.
- Test one larger video while both pages remain foregrounded.
- Test on mobile data/Wi-Fi. If ICE fails only on one network, that network may require a TURN relay.
- Confirm no media files are being uploaded to the Worker; only WebRTC negotiation metadata goes through its signaling WebSocket.
