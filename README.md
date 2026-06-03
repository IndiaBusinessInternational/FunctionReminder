# IBI Function Reminder

`v2` is a mobile-friendly web app for organizing wedding and function invitations. It can scan or upload an invitation card, extract details through local OCR or a user-selected AI API, save the scanned card copy for later viewing, and prepare reminders.

## Features

- Invitation card camera capture or image upload.
- Browser-based local OCR extraction with editable function name, date, time, venue and notes.
- Optional bring-your-own-key AI extraction for Gemini, OpenAI or Claude.
- Saved scanned invitation copies that can be opened later from each function card.
- Three reminder times for every saved function:
  - One day before at 7:00 AM.
  - On the function date at 7:00 AM.
  - One hour before the function begins.
- Loud alarm, vibration where supported, and optional persistent notification alert while the app is active or backgrounded.
- `.ics` calendar download with all three alerts, for reliable phone reminders even after the web app is closed.
- Last-attended function record and a confirmed Clear All switch.
- Installable app shell when hosted through HTTPS, including GitHub Pages.

## Important Alert Note

Browsers do not allow a GitHub Pages web app to guarantee custom loud audio after the page has been fully closed. For dependable background alerts, use **Download phone alarm calendar** after saving functions and import the downloaded calendar file on the phone. Sound volume and alarm delivery then follow the phone calendar/alarm settings.

## AI API Safety

The app supports Gemini, OpenAI and Claude as a bring-your-own-key feature. Do not place API keys inside `index.html`, `app.js` or any GitHub file. The UI lets a user paste and save their own key in browser storage on their device.

For production use with multiple users, a secure server proxy is safer because provider API keys should normally live on a server, not in public browser code.

## Host On GitHub Pages

1. Create a GitHub repository and upload the files in this folder.
2. In the repository, open **Settings > Pages**.
3. Set the deployment source to **Deploy from a branch**, then select the `main` branch and `/ (root)` folder.
4. Open the GitHub Pages link after deployment. Camera access, installation and notifications work best on the HTTPS Pages address rather than by opening `index.html` directly.

No server or database is required. Saved function details remain in the browser storage of the device being used.

## Scanned Card Storage

Scanned invitation copies are compressed and saved in the browser with IndexedDB. They remain on the same device/browser profile unless the user deletes the function or uses the Clear All switch.

## Versioning

The visible version value is set in `index.html` and `app.js`.

- Use `v1.1`, `v1.2` and similar values for small fixes and refinements.
- Use `v2`, `v3` and similar values for major new features.

When increasing the version, also update the cache name in `service-worker.js` so installed devices receive refreshed files.
