# Aegis Shadow AI Guard (Chrome extension, beta)

Tells the company which AI tools are opened in its browsers, blocks the ones it decided to block, and points
people to the approved ones. Decisions are made on the dashboard's Shadow AI page.

## What it records

For each AI tool on the watch list: the domain, the time, whether it was a page visit or a background call,
whether it was blocked, and who (a random ID per browser, or the Chrome profile's work email if IT turns that
on). Repeat sightings of the same tool within ten minutes count once. It never records the page address, what
people type or what the tool answers.

## Settings (Chrome policy)

Force-install it with Google Admin, Intune or Jamf and set these managed values (`schema.json`):

| Key | Value |
|---|---|
| `gatewayUrl` | The Aegis gateway, e.g. `https://gateway.example.com` |
| `apiKey` | An Aegis API key with only the `shadow_ai:ingest` permission. The tenant comes from the key. |
| `identifyUsers` | `true` to report the profile's work email; otherwise a random ID per browser |

Policy values can't be changed by employees. Everything else (watch list, monitor or block for undecided tools,
blocked and approved tools, the block page's message and links) comes from the gateway every five minutes,
and the gateway can't change where the extension reports or with which key.

Without policy, the popup offers a test setup (gateway address and key) for trying it out.

## Files

- `lib.js`: the decisions (settings precedence, blocking rules, what to record). No Chrome APIs.
- `background.js`: service worker: syncs settings, applies blocking rules, records and reports sightings.
- `blocked.html`/`blocked.js`: the page shown instead of a blocked tool.
- `popup.html`/`popup.js`: status for employees; test setup when not managed.

## Tests

```bash
node --test extensions/shadow-ai-guard/tests/lib.test.mjs
```

## Permissions

`<all_urls>` host access is needed because the watch list comes from the gateway and can include tools added
later; the extension only acts on domains on that list. `identity.email` is used only when `identifyUsers` is on.
