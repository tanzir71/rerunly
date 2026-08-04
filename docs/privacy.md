# Rerunly privacy disclosure — V1 draft

Rerunly has no backend, account system, telemetry, advertising, or cloud synchronization. It connects directly from Chrome to the model provider selected by the user.

## Data processed

During an active run, Rerunly processes screenshots of controlled tabs, accessibility and DOM-derived page evidence, tab titles and URLs, console errors, failed network-request summaries, user task instructions, and model responses. OpenRouter sends this data to a remote service and potentially an upstream model provider. LM Studio keeps model requests on the configured local endpoint.

Screenshots are locally redacted over recognized password, payment, and task-secret input regions before being sent. Rerunly cannot guarantee that unrelated sensitive information visible elsewhere on a page will be detected or removed.

## Stored data

Rerunly stores provider metadata, saved task definitions, ordinary variables, visual-disclosure choices, and up to 20 sanitized run summaries in Chrome local storage. Provider API keys and protected task variables are encrypted in IndexedDB with a non-extractable AES-256-GCM device key.

Rerunly does not persist screenshots, raw page snapshots, model conversation context, decrypted secret values, website passwords, cookies, OTPs, payment credentials, or identity documents.

## User control

Users choose the provider, approve its visual-data disclosure, select task origins, approve sensitive actions, stop any run, delete tasks and protected values, and remove the extension and its local data through Chrome.

This draft must be reviewed against the final shipped behavior and hosted at a stable public URL before Chrome Web Store submission.
