# Connect Henry to real Google Calendar

Henry defaults to deterministic tools so every workflow can be tested without credentials. For the hackathon demo, use a **single-owner OAuth bootstrap** instead of building multi-user account linking. It gives the real Calendar read/write behavior with much less risk and engineering time.

## 1. Enable Google Calendar API

In the same Google Cloud project used by Henry, enable **Google Calendar API**.

The provisioning script now enables it automatically:

```bash
./scripts/provision.sh YOUR_PROJECT_ID asia-southeast1
```

## 2. Configure the OAuth consent screen

In **Google Auth Platform**:

1. Set the application name to `Henry`.
2. Choose the audience appropriate for your account.
3. Keep publishing status in testing during development.
4. Add the Google account used in the demo as a test user.
5. Add the Calendar events scope:

```text
https://www.googleapis.com/auth/calendar.events
```

This scope lets Henry read and edit events without granting Calendar sharing or permanent-deletion administration.

## 3. Create the OAuth client

Create an OAuth client with application type **Desktop app** and download its JSON file. Save it outside the repository or with a name matching `oauth-client*.json`, which Git ignores.

For this owner-operated hackathon demo, Desktop OAuth is deliberate. A public multi-user product would use the Web application authorization-code flow and a per-user encrypted token store.

## 4. Generate the authorized-user token

From `cloud-backend`:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
python scripts/bootstrap_google_oauth.py \
  --client-secrets /absolute/path/to/oauth-client.json \
  --output oauth-token.json
```

Your browser will open Google's real consent screen. Sign in with the demo account and approve Calendar access. The resulting `oauth-token.json` includes a refresh token and is ignored by Git.

## 5. Test locally

Keep the JSON out of `.env` files. Export it into the process environment:

```bash
export HENRY_GOOGLE_OAUTH_TOKEN_JSON="$(tr -d '\n' < oauth-token.json)"
export HENRY_TOOL_MODE=live
export DISCORD_BOT_TOKEN='your-discord-bot-token'
export HENRY_CONTACTS_JSON='{"A":"discord-user-id"}'
uvicorn henry_cloud.main:app --reload --port 8080
```

The current live workflow combines Google Calendar with Discord messaging, so live mode requires both the Calendar token and Discord values. Keep `HENRY_TOOL_MODE=demo` until all three are present.

## 6. Store the token in Secret Manager

Create the secret once:

```bash
gcloud secrets create henry-google-oauth-token \
  --project=YOUR_PROJECT_ID \
  --data-file=oauth-token.json
```

For a later token version:

```bash
gcloud secrets versions add henry-google-oauth-token \
  --project=YOUR_PROJECT_ID \
  --data-file=oauth-token.json
```

The provision script grants Henry's runtime service account Secret Manager access. Bind the secret to the private worker:

```bash
gcloud run services update henry-worker \
  --project=YOUR_PROJECT_ID \
  --region=asia-southeast1 \
  --update-secrets=HENRY_GOOGLE_OAUTH_TOKEN_JSON=henry-google-oauth-token:latest
```

Add the Discord token through Secret Manager too, configure `HENRY_CONTACTS_JSON`, and only then switch the worker to live tools:

```bash
gcloud run services update henry-worker \
  --project=YOUR_PROJECT_ID \
  --region=asia-southeast1 \
  --update-env-vars=HENRY_TOOL_MODE=live,HENRY_CONTACTS_JSON='{"A":"discord-user-id"}'
```

Do not put OAuth tokens, client secrets, or Discord tokens in GitHub, shell history, screenshots, or the demo video.
