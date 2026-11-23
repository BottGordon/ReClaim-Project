# ReClaim backend

The API runs on Python 3.11+ with FastAPI and Uvicorn. It reads and writes the existing `backend/data/reclaim.json` format and accepts existing scrypt password hashes.

## Run locally

From the project root, install the Python dependencies and start the API:

```powershell
python -m pip install -r backend/requirements.txt
npm run backend
```

The API listens on `127.0.0.1:3001` by default. Vite proxies `/api` requests to it. If Vite isn't running, start it in another terminal with `npm run dev`.

To switch an existing installation, stop the old Node API before starting the Python API. Use the same `RECLAIM_DATA_DIR` so the new process opens the existing records. Sessions are held in memory, so users will sign in again after the switch.

## Deploy with Cloudflare Pages

Pages serves `dist` and the Pages Function in `functions/api` forwards same-origin API requests to a separate HTTPS Python origin. The frontend leaves `VITE_API_BASE` unset so requests go through that function.

For a frontend configured to call the API directly with `VITE_API_BASE`, set `CORS_ORIGINS` on the API host to the frontend's exact origin. Separate multiple origins with commas.

1. Install dependencies with `python -m pip install -r backend/requirements.txt`, then run `python backend/server.py` on a Python 3.11+ host. Use `NODE_ENV=production` and a single instance with `RECLAIM_DATA_DIR` on a persistent volume. Set `API_HOST=0.0.0.0` if required by the host, or leave the default loopback binding if using Cloudflare Tunnel on the same machine. Configure the backend Supabase URL, public key, and server-only service-role key. Verify the HTTPS origin serves `/api/health`.
2. Build from the repository root. Run `git lfs pull` so the item photos are available, then run `npm ci` and `npm run build`. Supply `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`) in the build environment. Use the public browser key only.
3. For a new Direct Upload project, run `npx wrangler login` and `npx wrangler pages project create`. In the Pages project settings, set `RECLAIM_API_ORIGIN` to the Python service's HTTPS origin, such as `https://api.example.com`. Run `npx wrangler pages deploy dist --project-name <project-name>` from the repository root so Wrangler includes the Pages Function. For Git integration, select `main`, a build command that fetches Git LFS objects before `npm run build`, and the `dist` output directory.
4. Open the Pages URL and check `/api/health`. Sign in with a regular account for Browse and with an admin account for `/admin`. Copy any existing local records to the hosted persistent volume separately if you want to retain them.

## Admin Console

The web sign-in form authenticates with Supabase Auth. Configure `VITE_SUPABASE_URL` and the project's public `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`). The backend verifies the Auth access token, checks `profiles.is_admin` by Auth user ID, and issues a ReClaim session for the existing record APIs. Set `SUPABASE_SERVICE_ROLE_KEY` only in the backend environment. Apply the Supabase migrations so client profile updates cannot edit admin permissions.

Accounts created only through the legacy local registration flow need a verified Supabase Auth account with the same email before they can use web sign-in. Existing ReClaim records are linked on the first verified Supabase sign-in.

The console and student workspace share the API's record store. Claim decisions, custody changes, privacy publication, match links, and desk settings persist there. Any reports or claims already stored only in Supabase require a separate data migration. New IDs and Cards reports are held for privacy review until an administrator publishes redacted text.

## PLM Outlook email delivery

PLM registration requires an `@plm.edu.ph` address. External User registration accepts other email domains. Both registration and password reset use a one-time code sent to the address on the account. To send real mail, copy `.env.example` to `.env` and configure the Microsoft Graph values:

- `MS_GRAPH_TENANT_ID`: Microsoft Entra tenant ID.
- `MS_GRAPH_CLIENT_ID`: app registration client ID.
- `MS_GRAPH_CLIENT_SECRET`: app secret, kept only in the backend environment.
- `MS_GRAPH_SENDER`: PLM mailbox address the application is authorized to send as.

The app registration needs Microsoft Graph `Mail.Send` **application** permission and administrator consent. The sender mailbox must be licensed/available and permitted by PLM's Microsoft 365 policy. Restart the backend after adding the values. Never commit `.env` or expose the app secret to frontend code.

Without these values, local development prints the OTP in the backend terminal and shows it in the local UI. Production mode rejects OTP requests until mail delivery is configured.

## Current scope

The API includes verified PLM and External User registration/login, password reset/change, item reports, private ownership-answer checks, multiple claims, return/undo-return, participant messaging/read state, notifications, and profile photos. The JSON store and in-memory sessions are for local development and demos; use a managed database and persistent session store before production deployment.
