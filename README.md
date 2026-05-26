# IBI Function Reminder

`v1.0` is a mobile-friendly web app for organizing wedding and function invitations. It can scan or upload an invitation card, extract text in the browser, let the user correct the function details, and prepare reminders.

## Features

- Invitation card camera capture or image upload.
- Browser-based OCR extraction with editable function name, date, time, venue and notes.
- Three reminder times for every saved function:
  - One day before at 7:00 AM.
  - On the function date at 7:00 AM.
  - One hour before the function begins.
- Loud alarm, vibration where supported, and optional notification alert while the app is open.
- `.ics` calendar download with all three alerts, for reliable phone reminders even after the web app is closed.
- Last-attended function record and a confirmed Clear All switch.
- Installable app shell when hosted through HTTPS, including GitHub Pages.

## Important Alert Note

Browsers do not allow a GitHub Pages web app to guarantee a loud alarm after the page has been closed. For dependable background alerts, use **Download all to calendar** after saving functions and import the downloaded calendar file on the phone. Sound volume and alarm delivery then follow the phone calendar settings.

## Host On GitHub Pages

1. Create a GitHub repository and upload the files in this folder.
2. In the repository, open **Settings > Pages**.
3. Set the deployment source to **Deploy from a branch**, then select the `main` branch and `/ (root)` folder.
4. Open the GitHub Pages link after deployment. Camera access, installation and notifications work best on the HTTPS Pages address rather than by opening `index.html` directly.

No server or database is required. Saved function details remain in the browser storage of the device being used.

## Versioning

The visible version value is set in `index.html` and `app.js`.

- Use `v1.1`, `v1.2` and similar values for small fixes and refinements.
- Use `v2`, `v3` and similar values for major new features.

When increasing the version, also update the cache name in `service-worker.js` so installed devices receive refreshed files.
