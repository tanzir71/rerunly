# Rerunly

**Save it. Play it. Rerun it.**

Rerunly is an unpacked Chrome 116+ extension that connects directly to a vision- and tool-capable OpenRouter or LM Studio model. It runs browser tasks through a visual feedback loop:

1. Capture a redacted screenshot plus accessibility, DOM, console, network, navigation, and tab evidence.
2. Ask the selected model for one atomic browser action and an expected visible outcome.
3. Apply policy checks and execute the action through Chrome DevTools Protocol.
4. Wait for page stability and capture the resulting screen automatically.
5. Make a separate verification call to the same model.
6. Continue, recover, ask for approval, or stop based on verified evidence.

The model never supplies executable JavaScript. Browser interaction is limited to Rerunly's fixed tools.

## Install locally

```powershell
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the build output folder inside this repository:

```text
<repo>/.output/chrome-mv3
```

Pin Rerunly and click its toolbar icon to open the side panel.

## Configure a model

### OpenRouter

1. Open **Settings → OpenRouter**.
2. Enter an OpenRouter API key.
3. Select **Find compatible models**. Rerunly lists only models advertising image input and tool calling.
4. Save the provider and accept the remote visual-data disclosure.

### LM Studio

1. Start LM Studio's local API server, normally at `http://localhost:1234`.
2. Load a vision model with native/trained tool use.
3. Open **Settings → LM Studio**, find the compatible model, and save it.
4. Accept the local visual-data disclosure.

V1 intentionally accepts only `localhost`, `127.0.0.1`, or `[::1]` LM Studio endpoints.

## Security model

- Provider API keys and protected task variables are encrypted with AES-256-GCM.
- The non-extractable device key and ciphertext live in IndexedDB; plaintext is never written to Chrome storage.
- Models receive protected aliases such as `{{secret:work_email}}`, not values.
- Password, payment, and registered secret-field rectangles are blacked out locally before screenshots leave Chrome.
- Raw screenshots, DOM snapshots, model context, and plaintext secrets are not persisted.
- Only the previous and current redacted screenshots remain in memory during verification.
- Run history contains at most 20 sanitized textual summaries.

This vault reduces casual disclosure from stored extension data. It cannot protect secrets from a compromised browser profile, extension process, operating system, or malicious software with equivalent access. Other sensitive information visibly rendered outside recognized input fields may still be captured.

## Guardrails

Rerunly pauses for new origins, ungranted protected-value destinations, file selection, external communication, sensitive submission, authorization, or repeated no-progress behavior. It blocks internal browser pages, unsafe URL schemes, purchases, financial transactions, account creation, permanent deletion, security-setting changes, CAPTCHA bypass, and payment or identity credentials.

## Development

```powershell
npm run dev        # WXT development build
npm run build      # Production MV3 build
npm run typecheck  # Strict TypeScript check
npm test           # Unit and mocked-provider integration tests
npm run test:lmstudio # Optional real LM Studio discovery test (set RUN_LMSTUDIO_LIVE=1)
npm run test:e2e   # Build and load the extension in Playwright Chromium
npm run zip        # Create the unpacked-release archive
```

## Landing page and GitHub Pages

The marketing site is in `site/` and builds to `site-dist/` with relative asset URLs, so it works from both a GitHub Pages project subpath and a custom domain.

```powershell
npm run dev:site
npm run build:site
```

The included GitHub Actions workflow publishes `site-dist/` whenever landing-page files change on `main`. In the repository settings, select **GitHub Actions** as the Pages source; no repository-name-specific base path is required.

The visual E2E fixture in `e2e/fixtures/visual-task.html` exposes success, validation-error, overlay, password-redaction, and CAPTCHA states for manual model testing.

## Current V1 boundaries

- Manual Play only; no alarms or unattended schedules.
- No accounts, backend, cloud sync, telemetry, or native messaging.
- No website-password, cookie, OTP, payment, or identity-document storage.
- No transactional or destructive browser actions.
- Browser action runs do not resume after Chrome terminates the service worker. They are safely marked interrupted and can be started fresh.

See [`docs/architecture.md`](docs/architecture.md), [`docs/privacy.md`](docs/privacy.md), and [`store/listing.md`](store/listing.md) for implementation and release details.

Five generated 1280×800 listing images are available in [`store-assets`](store-assets). Recreate them from the production UI with `npm run capture:store`.
