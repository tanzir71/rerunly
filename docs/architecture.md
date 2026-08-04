# Architecture

```text
Side panel ── typed commands ──> MV3 service worker
                                  │
                                  ├─ Device vault (IndexedDB + AES-GCM)
                                  ├─ Tasks/settings/history (chrome.storage.local)
                                  ├─ Policy and approval engine
                                  ├─ OpenRouter / local LM Studio adapter
                                  └─ Chrome debugger session
                                      ├─ Accessibility + DOMSnapshot
                                      ├─ Page screenshot + local redaction
                                      ├─ Console/network/navigation events
                                      └─ Fixed Input/Page/Tab actions

Observation → planner call → policy → one action → stability gate
      ↑                                                │
      └── recovery/replan ← verifier call ← screenshot ┘
```

## Run invariants

- One state-changing tool is executed per planning turn.
- Every state-changing tool is followed by stabilization, capture, and independent verification.
- `complete` is accepted only from the verification call, never from the planner alone.
- An uncertain result gets one delayed recapture.
- A step gets at most two corrective attempts; three consecutive no-progress outcomes require user input.
- Stop aborts provider requests, detaches the debugger, discards visual state, and records a sanitized status.

## Persistence boundaries

`chrome.storage.local` contains provider metadata, tasks, settings, sanitized history, and a non-sensitive active checkpoint. IndexedDB contains the non-extractable device key and encrypted secret records. Screenshots and model messages are ephemeral service-worker values only.

## Fixed model tools

`browser_open`, `browser_click`, `browser_type`, `browser_type_secret`, `browser_select`, `browser_scroll`, `browser_wait`, `browser_back`, `browser_refresh`, `browser_new_tab`, `browser_switch_tab`, `browser_close_tab`, `browser_file_select`, `browser_observe`, and `browser_finish`.

Coordinates are bounded to the observed viewport. Navigation is limited to HTTP/HTTPS. File selection opens Chrome's native picker and requires the user to complete it.
