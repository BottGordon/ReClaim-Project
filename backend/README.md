# ReClaim local backend

The API is a dependency-free Node.js service. It stores records in `backend/data/reclaim.json` and hashes passwords with Node's built-in `node:crypto` module.

## Run locally

Open two VS Code terminals in the project root:

```powershell
npm run backend
npm run dev
```

The API listens on `127.0.0.1:3001`; Vite proxies `/api` requests to it.

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
