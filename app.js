(function () {
  "use strict";

  const APP_VERSION = "v1.0";
  const STORAGE_KEY = "ibi-function-reminder-data-v1";
  const ALARM_GRACE_MS = 15 * 60 * 1000;
  const defaultState = {
    events: [],
    settings: { alarmsEnabled: true, soundEnabled: true },
    triggered: {},
    snoozes: []
  };

  let state = loadState();
  let selectedImage = null;
  let selectedImageUrl = null;
  let alarmAudioContext = null;
  let alarmSoundInterval = null;
  let activeAlarm = null;
  let alarmQueue = [];
  let installPrompt = null;
  let toastTimer = null;
  let ocrLoader = null;

  const elements = {
    appVersion: document.getElementById("appVersion"),
    nextReminder: document.getElementById("nextReminder"),
    cameraInput: document.getElementById("cameraInput"),
    fileInput: document.getElementById("fileInput"),
    scanPreview: document.getElementById("scanPreview"),
    invitationPreview: document.getElementById("invitationPreview"),
    fileName: document.getElementById("fileName"),
    extractButton: document.getElementById("extractButton"),
    ocrProgress: document.getElementById("ocrProgress"),
    ocrProgressBar: document.getElementById("ocrProgressBar"),
    ocrProgressText: document.getElementById("ocrProgressText"),
    form: document.getElementById("eventForm"),
    eventName: document.getElementById("eventName"),
    eventDate: document.getElementById("eventDate"),
    eventTime: document.getElementById("eventTime"),
    eventVenue: document.getElementById("eventVenue"),
    eventNotes: document.getElementById("eventNotes"),
    resetFormButton: document.getElementById("resetFormButton"),
    alarmsToggle: document.getElementById("alarmsToggle"),
    soundToggle: document.getElementById("soundToggle"),
    notificationStatus: document.getElementById("notificationStatus"),
    notificationsButton: document.getElementById("notificationsButton"),
    testAlarmButton: document.getElementById("testAlarmButton"),
    calendarAllButton: document.getElementById("calendarAllButton"),
    eventCount: document.getElementById("eventCount"),
    emptyState: document.getElementById("emptyState"),
    eventList: document.getElementById("eventList"),
    eventTemplate: document.getElementById("eventTemplate"),
    lastAttended: document.getElementById("lastAttended"),
    clearAllToggle: document.getElementById("clearAllToggle"),
    clearConfirmation: document.getElementById("clearConfirmation"),
    confirmClearButton: document.getElementById("confirmClearButton"),
    cancelClearButton: document.getElementById("cancelClearButton"),
    alarmModal: document.getElementById("alarmModal"),
    alarmTitle: document.getElementById("alarmTitle"),
    alarmMessage: document.getElementById("alarmMessage"),
    dismissAlarmButton: document.getElementById("dismissAlarmButton"),
    snoozeAlarmButton: document.getElementById("snoozeAlarmButton"),
    toast: document.getElementById("toast"),
    installButton: document.getElementById("installButton")
  };

  initialize();

  function initialize() {
    elements.appVersion.textContent = APP_VERSION;
    elements.alarmsToggle.checked = state.settings.alarmsEnabled;
    elements.soundToggle.checked = state.settings.soundEnabled;
    bindEvents();
    updateNotificationUI();
    render();
    checkDueAlarms();
    window.setInterval(checkDueAlarms, 30000);

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("./service-worker.js").catch(function () {
        showToast("Offline installation is not available in this browser.");
      });
    }
  }

  function bindEvents() {
    elements.cameraInput.addEventListener("change", handleFileSelection);
    elements.fileInput.addEventListener("change", handleFileSelection);
    elements.extractButton.addEventListener("click", extractInvitationDetails);
    elements.form.addEventListener("submit", saveEvent);
    elements.resetFormButton.addEventListener("click", clearForm);
    elements.alarmsToggle.addEventListener("change", updateSettings);
    elements.soundToggle.addEventListener("change", updateSettings);
    elements.notificationsButton.addEventListener("click", requestNotifications);
    elements.testAlarmButton.addEventListener("click", testAlarm);
    elements.calendarAllButton.addEventListener("click", function () {
      downloadCalendar(state.events, "ibi-functions.ics");
    });
    elements.eventList.addEventListener("click", handleEventAction);
    elements.eventList.addEventListener("change", handleAttendanceChange);
    elements.clearAllToggle.addEventListener("change", toggleClearConfirmation);
    elements.confirmClearButton.addEventListener("click", clearAllData);
    elements.cancelClearButton.addEventListener("click", cancelClear);
    elements.dismissAlarmButton.addEventListener("click", dismissAlarm);
    elements.snoozeAlarmButton.addEventListener("click", snoozeAlarm);
    elements.installButton.addEventListener("click", installApp);
    document.addEventListener("pointerdown", prepareAudio, { once: true });

    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      installPrompt = event;
      elements.installButton.hidden = false;
    });
  }

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!stored) {
        return structuredClone(defaultState);
      }
      return {
        events: Array.isArray(stored.events) ? stored.events : [],
        settings: Object.assign({}, defaultState.settings, stored.settings),
        triggered: stored.triggered || {},
        snoozes: Array.isArray(stored.snoozes) ? stored.snoozes : []
      };
    } catch (error) {
      return structuredClone(defaultState);
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function handleFileSelection(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    selectedImage = file;
    if (selectedImageUrl) {
      URL.revokeObjectURL(selectedImageUrl);
    }
    selectedImageUrl = URL.createObjectURL(file);
    elements.invitationPreview.src = selectedImageUrl;
    elements.fileName.textContent = file.name || "Captured invitation card";
    elements.scanPreview.hidden = false;
    elements.ocrProgress.hidden = true;
    showToast("Card ready. Select Extract details to read it.");
  }

  async function extractInvitationDetails() {
    if (!selectedImage) {
      showToast("Select or photograph an invitation card first.");
      return;
    }
    elements.extractButton.disabled = true;
    elements.ocrProgress.hidden = false;
    setProgress(4, "Loading text reader...");

    try {
      await loadTextReader();
      setProgress(7, "Preparing card scan...");
      const result = await window.Tesseract.recognize(selectedImage, "eng", {
        logger: function (message) {
          if (message.status === "recognizing text") {
            const percentage = Math.round((message.progress || 0) * 100);
            setProgress(percentage, "Reading text... " + percentage + "%");
          }
        }
      });
      const parsed = parseInvitationText(result.data.text || "");
      fillForm(parsed);
      setProgress(100, "Details extracted");
      showToast(parsed.date ? "Details extracted. Please review them before saving." : "Text read. Please add or correct the date and time.");
    } catch (error) {
      setProgress(0, "Could not read this card");
      showToast("This card could not be read clearly. Please enter the details manually.");
    } finally {
      elements.extractButton.disabled = false;
    }
  }

  function loadTextReader() {
    if (window.Tesseract) {
      return Promise.resolve(window.Tesseract);
    }
    if (ocrLoader) {
      return ocrLoader;
    }
    ocrLoader = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.onload = function () {
        resolve(window.Tesseract);
      };
      script.onerror = function () {
        ocrLoader = null;
        reject(new Error("Text reader failed to load"));
      };
      document.head.appendChild(script);
    });
    return ocrLoader;
  }

  function setProgress(percentage, text) {
    elements.ocrProgressBar.style.width = Math.max(4, percentage) + "%";
    elements.ocrProgressText.textContent = text;
  }

  function parseInvitationText(text) {
    const lines = text.split(/\r?\n/).map(function (line) {
      return line.replace(/\s+/g, " ").trim();
    }).filter(Boolean);
    const normalized = lines.join(" ");
    const parsedDate = findDate(normalized);
    const parsedTime = findTime(normalized);
    const venueLine = lines.find(function (line) {
      return /\b(venue|location|hall|mahal|mandapam|auditorium|church|temple|resort|hotel)\b/i.test(line);
    });
    const titleLine = lines.find(function (line) {
      return /\b(wedding|marriage|reception|engagement|birthday|function|ceremony|anniversary)\b/i.test(line) &&
        !/\b(invitation|invite|venue|date|time)\b/i.test(line);
    }) || lines.find(function (line) {
      return !/\b(invitation|cordially|request|venue|date|time|rsvp)\b/i.test(line) && line.length > 4;
    });

    return {
      name: titleLine || "",
      date: parsedDate,
      time: parsedTime,
      venue: venueLine ? venueLine.replace(/^(venue|location)\s*[:\-]\s*/i, "") : "",
      notes: text.trim() ? "Scanned from invitation card" : ""
    };
  }

  function findDate(text) {
    const iso = text.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
    if (iso) {
      return validDateValue(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    }

    const numeric = text.match(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2})\b/);
    if (numeric) {
      return validDateValue(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
    }

    const monthNames = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
    const dayFirst = text.match(new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(" + monthNames + ")\\s*,?\\s*(20\\d{2})\\b", "i"));
    if (dayFirst) {
      return validDateValue(Number(dayFirst[3]), monthNumber(dayFirst[2]), Number(dayFirst[1]));
    }
    const monthFirst = text.match(new RegExp("\\b(" + monthNames + ")\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(20\\d{2})\\b", "i"));
    if (monthFirst) {
      return validDateValue(Number(monthFirst[3]), monthNumber(monthFirst[1]), Number(monthFirst[2]));
    }
    return "";
  }

  function monthNumber(monthName) {
    const name = monthName.toLowerCase().slice(0, 3);
    return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(name) + 1;
  }

  function validDateValue(year, month, day) {
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return "";
    }
    return year + "-" + pad(month) + "-" + pad(day);
  }

  function findTime(text) {
    const twelveHour = text.match(/\b(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
    if (twelveHour) {
      let hour = Number(twelveHour[1]) % 12;
      if (/p/i.test(twelveHour[3])) {
        hour += 12;
      }
      return pad(hour) + ":" + pad(Number(twelveHour[2] || 0));
    }
    const labelledTime = text.match(/\b(?:time|starts?|from)\s*[:\-]?\s*([01]?\d|2[0-3])[:.](\d{2})\b/i);
    return labelledTime ? pad(Number(labelledTime[1])) + ":" + labelledTime[2] : "";
  }

  function fillForm(details) {
    elements.eventName.value = details.name;
    elements.eventDate.value = details.date;
    elements.eventTime.value = details.time;
    elements.eventVenue.value = details.venue;
    elements.eventNotes.value = details.notes;
  }

  function clearForm() {
    elements.form.reset();
    elements.cameraInput.value = "";
    elements.fileInput.value = "";
    selectedImage = null;
    if (selectedImageUrl) {
      URL.revokeObjectURL(selectedImageUrl);
      selectedImageUrl = null;
    }
    elements.scanPreview.hidden = true;
  }

  function saveEvent(event) {
    event.preventDefault();
    const functionDate = localDate(elements.eventDate.value, elements.eventTime.value);
    if (!functionDate || Number.isNaN(functionDate.getTime())) {
      showToast("Please enter a valid function date and start time.");
      return;
    }

    const savedEvent = {
      id: generateId(),
      name: elements.eventName.value.trim(),
      date: elements.eventDate.value,
      time: elements.eventTime.value,
      venue: elements.eventVenue.value.trim(),
      notes: elements.eventNotes.value.trim(),
      createdAt: new Date().toISOString(),
      attendedAt: null
    };
    state.events.push(savedEvent);
    persist();
    render();
    clearForm();
    prepareAudio();
    showToast("Function saved with 3 reminders. Download it to your calendar for background alerts.");
  }

  function generateId() {
    return "event-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
  }

  function updateSettings() {
    state.settings.alarmsEnabled = elements.alarmsToggle.checked;
    state.settings.soundEnabled = elements.soundToggle.checked;
    if (!state.settings.soundEnabled) {
      stopAlarmSound();
    } else {
      prepareAudio();
    }
    persist();
    showToast(state.settings.alarmsEnabled ? "Reminder alerts are active." : "Reminder alerts are paused in this app.");
  }

  async function requestNotifications() {
    if (!("Notification" in window)) {
      showToast("Notifications are not supported in this browser.");
      return;
    }
    const permission = await Notification.requestPermission();
    updateNotificationUI();
    if (permission === "granted") {
      showToast("Notifications enabled while reminders are active.");
    } else {
      showToast("Notification permission was not enabled.");
    }
  }

  function updateNotificationUI() {
    if (!("Notification" in window)) {
      elements.notificationStatus.textContent = "Unavailable in this browser";
      elements.notificationsButton.disabled = true;
      return;
    }
    if (Notification.permission === "granted") {
      elements.notificationStatus.textContent = "Enabled";
      elements.notificationsButton.textContent = "Enabled";
      elements.notificationsButton.disabled = true;
    } else if (Notification.permission === "denied") {
      elements.notificationStatus.textContent = "Blocked in browser settings";
      elements.notificationsButton.textContent = "Blocked";
      elements.notificationsButton.disabled = true;
    } else {
      elements.notificationStatus.textContent = "Permission not requested";
    }
  }

  function render() {
    const sortedEvents = state.events.slice().sort(function (a, b) {
      return localDate(a.date, a.time) - localDate(b.date, b.time);
    });
    elements.eventList.replaceChildren();
    elements.emptyState.hidden = sortedEvents.length > 0;
    elements.calendarAllButton.disabled = sortedEvents.length === 0;
    elements.eventCount.textContent = sortedEvents.length + (sortedEvents.length === 1 ? " function" : " functions");

    sortedEvents.forEach(function (event) {
      elements.eventList.appendChild(createEventCard(event));
    });
    renderNextReminder();
    renderLastAttended();
  }

  function createEventCard(event) {
    const node = elements.eventTemplate.content.cloneNode(true);
    const article = node.querySelector(".event-card");
    const functionDate = localDate(event.date, event.time);
    const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short" });
    article.dataset.eventId = event.id;
    article.querySelector('[data-field="day"]').textContent = pad(functionDate.getDate());
    article.querySelector('[data-field="month"]').textContent = dateFormatter.format(functionDate);
    article.querySelector('[data-field="name"]').textContent = event.name;
    article.querySelector('[data-field="meta"]').textContent = formatFunctionDate(functionDate);
    article.querySelector('[data-field="venue"]').textContent = event.venue || "Venue not provided";
    article.querySelector(".attended-badge").hidden = !event.attendedAt;
    const attendanceToggle = article.querySelector('[data-action="attend"]');
    attendanceToggle.checked = Boolean(event.attendedAt);

    const reminderArea = article.querySelector('[data-field="reminders"]');
    getReminders(event).forEach(function (reminder) {
      const tag = document.createElement("span");
      tag.className = "reminder-tag";
      tag.textContent = reminder.shortLabel;
      reminderArea.appendChild(tag);
    });
    return node;
  }

  function renderNextReminder() {
    const now = new Date();
    const reminders = state.events.flatMap(getReminders).concat(state.snoozes.map(function (snooze) {
      const event = state.events.find(function (item) { return item.id === snooze.eventId; });
      return event ? {
        id: snooze.id,
        event: event,
        at: new Date(snooze.at),
        label: "Snoozed reminder",
        shortLabel: "Snoozed"
      } : null;
    }).filter(Boolean)).filter(function (reminder) {
      return reminder.at > now;
    }).sort(function (a, b) {
      return a.at - b.at;
    });

    if (!reminders.length) {
      elements.nextReminder.innerHTML = '<p class="caption">Next alert</p><strong>No scheduled alerts</strong><span>Add an invitation to begin.</span>';
      return;
    }
    const next = reminders[0];
    elements.nextReminder.replaceChildren();
    const caption = document.createElement("p");
    caption.className = "caption";
    caption.textContent = "Next alert";
    const title = document.createElement("strong");
    title.textContent = next.event.name;
    const timing = document.createElement("span");
    timing.textContent = next.label + " - " + formatFunctionDate(next.at);
    elements.nextReminder.append(caption, title, timing);
  }

  function renderLastAttended() {
    const attended = state.events.filter(function (event) {
      return event.attendedAt;
    }).sort(function (a, b) {
      return new Date(b.attendedAt) - new Date(a.attendedAt);
    })[0];
    elements.lastAttended.replaceChildren();
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    if (!attended) {
      title.textContent = "No attended function recorded";
      detail.textContent = "Use “Mark attended” on a saved function to keep a record here.";
    } else {
      title.textContent = attended.name;
      detail.textContent = "Function date: " + formatFunctionDate(localDate(attended.date, attended.time)) +
        (attended.venue ? " | " + attended.venue : "");
    }
    elements.lastAttended.append(title, detail);
  }

  function handleEventAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    const eventId = button.closest(".event-card").dataset.eventId;
    const savedEvent = state.events.find(function (item) { return item.id === eventId; });
    if (!savedEvent) {
      return;
    }
    if (button.dataset.action === "calendar") {
      downloadCalendar([savedEvent], safeFileName(savedEvent.name) + ".ics");
    } else if (button.dataset.action === "delete") {
      state.events = state.events.filter(function (item) { return item.id !== eventId; });
      state.snoozes = state.snoozes.filter(function (item) { return item.eventId !== eventId; });
      persist();
      render();
      showToast("Function removed.");
    }
  }

  function handleAttendanceChange(event) {
    if (!event.target.matches('input[data-action="attend"]')) {
      return;
    }
    const eventId = event.target.closest(".event-card").dataset.eventId;
    const savedEvent = state.events.find(function (item) { return item.id === eventId; });
    if (!savedEvent) {
      return;
    }
    savedEvent.attendedAt = event.target.checked ? new Date().toISOString() : null;
    persist();
    render();
    showToast(event.target.checked ? "Attendance saved." : "Attendance record removed.");
  }

  function toggleClearConfirmation() {
    elements.clearConfirmation.hidden = !elements.clearAllToggle.checked;
  }

  function cancelClear() {
    elements.clearAllToggle.checked = false;
    elements.clearConfirmation.hidden = true;
  }

  function clearAllData() {
    stopAlarmSound();
    localStorage.removeItem(STORAGE_KEY);
    state = structuredClone(defaultState);
    elements.alarmsToggle.checked = true;
    elements.soundToggle.checked = true;
    cancelClear();
    render();
    clearForm();
    showToast("All saved function details and reminders have been erased.");
  }

  function getReminders(event) {
    const start = localDate(event.date, event.time);
    const dayBefore = localDate(event.date, "07:00");
    dayBefore.setDate(dayBefore.getDate() - 1);
    const sameMorning = localDate(event.date, "07:00");
    const hourBefore = new Date(start.getTime() - 60 * 60 * 1000);
    return [
      { id: event.id + "-day-before", event: event, at: dayBefore, label: "1 day before at 7:00 AM", shortLabel: "Day before - 7 AM" },
      { id: event.id + "-day-of", event: event, at: sameMorning, label: "Function day at 7:00 AM", shortLabel: "Same day - 7 AM" },
      { id: event.id + "-hour-before", event: event, at: hourBefore, label: "1 hour before function", shortLabel: "1 hour before" }
    ];
  }

  function checkDueAlarms() {
    if (!state.settings.alarmsEnabled) {
      return;
    }
    const now = Date.now();
    const scheduled = state.events.flatMap(getReminders);
    const snoozed = state.snoozes.map(function (snooze) {
      const event = state.events.find(function (item) { return item.id === snooze.eventId; });
      return event ? {
        id: snooze.id,
        event: event,
        at: new Date(snooze.at),
        label: "Snoozed reminder",
        shortLabel: "Snoozed"
      } : null;
    }).filter(Boolean);
    scheduled.concat(snoozed).forEach(function (reminder) {
      const dueTime = reminder.at.getTime();
      if (!state.triggered[reminder.id] && dueTime <= now && now - dueTime <= ALARM_GRACE_MS) {
        state.triggered[reminder.id] = new Date().toISOString();
        if (reminder.id.indexOf("snooze-") === 0) {
          state.snoozes = state.snoozes.filter(function (item) { return item.id !== reminder.id; });
        }
        persist();
        queueAlarm(reminder);
      }
    });
  }

  function queueAlarm(reminder) {
    if (activeAlarm) {
      alarmQueue.push(reminder);
      return;
    }
    activeAlarm = reminder;
    elements.alarmTitle.textContent = reminder.event.name;
    elements.alarmMessage.textContent = reminder.label + ". " +
      (reminder.event.venue ? "Venue: " + reminder.event.venue + "." : "Open your invitation for venue details.");
    elements.alarmModal.hidden = false;
    if (state.settings.soundEnabled) {
      playAlarmSound();
      if ("vibrate" in navigator) {
        navigator.vibrate([400, 180, 400, 180, 700]);
      }
    }
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("IBI Function Reminder", {
        body: reminder.event.name + " - " + reminder.label,
        icon: "icons/app-icon.svg",
        tag: reminder.id
      });
    }
  }

  function testAlarm() {
    prepareAudio();
    queueAlarm({
      id: "test-" + Date.now(),
      event: { name: "Test alarm", venue: "Your reminder sound is ready" },
      label: "This is how a function reminder will alert you."
    });
  }

  function dismissAlarm() {
    stopAlarmSound();
    if ("vibrate" in navigator) {
      navigator.vibrate(0);
    }
    elements.alarmModal.hidden = true;
    activeAlarm = null;
    if (alarmQueue.length) {
      queueAlarm(alarmQueue.shift());
    }
  }

  function snoozeAlarm() {
    if (activeAlarm && activeAlarm.event.id) {
      state.snoozes.push({
        id: "snooze-" + Date.now(),
        eventId: activeAlarm.event.id,
        at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
      persist();
      renderNextReminder();
      showToast("Alarm snoozed for 10 minutes.");
    } else {
      showToast("Test alarm dismissed.");
    }
    dismissAlarm();
  }

  function prepareAudio() {
    if (!alarmAudioContext) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        alarmAudioContext = new AudioContext();
      }
    }
    if (alarmAudioContext && alarmAudioContext.state === "suspended") {
      alarmAudioContext.resume();
    }
  }

  function playAlarmSound() {
    prepareAudio();
    stopAlarmSound();
    if (!alarmAudioContext) {
      return;
    }
    soundBurst();
    alarmSoundInterval = window.setInterval(soundBurst, 1200);
  }

  function soundBurst() {
    if (!alarmAudioContext) {
      return;
    }
    [0, 0.23, 0.46].forEach(function (delay, index) {
      const oscillator = alarmAudioContext.createOscillator();
      const gain = alarmAudioContext.createGain();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(index === 1 ? 940 : 740, alarmAudioContext.currentTime + delay);
      gain.gain.setValueAtTime(0.0001, alarmAudioContext.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.35, alarmAudioContext.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, alarmAudioContext.currentTime + delay + 0.17);
      oscillator.connect(gain).connect(alarmAudioContext.destination);
      oscillator.start(alarmAudioContext.currentTime + delay);
      oscillator.stop(alarmAudioContext.currentTime + delay + 0.2);
    });
  }

  function stopAlarmSound() {
    if (alarmSoundInterval) {
      window.clearInterval(alarmSoundInterval);
      alarmSoundInterval = null;
    }
  }

  function downloadCalendar(events, fileName) {
    if (!events.length) {
      showToast("There are no saved functions to download.");
      return;
    }
    const contents = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//IBI//Function Reminder " + APP_VERSION + "//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH"
    ];

    events.forEach(function (event) {
      const start = localDate(event.date, event.time);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      contents.push("BEGIN:VEVENT");
      contents.push("UID:" + event.id + "@ibi-function-reminder");
      contents.push("DTSTAMP:" + formatIcsUtc(new Date()));
      contents.push("DTSTART:" + formatIcsUtc(start));
      contents.push("DTEND:" + formatIcsUtc(end));
      contents.push("SUMMARY:" + escapeIcs(event.name));
      if (event.venue) {
        contents.push("LOCATION:" + escapeIcs(event.venue));
      }
      contents.push("DESCRIPTION:" + escapeIcs(event.notes || "Saved from IBI Function Reminder"));
      getReminders(event).forEach(function (reminder) {
        contents.push("BEGIN:VALARM");
        contents.push("ACTION:DISPLAY");
        contents.push("TRIGGER;VALUE=DATE-TIME:" + formatIcsUtc(reminder.at));
        contents.push("DESCRIPTION:" + escapeIcs(event.name + " - " + reminder.label));
        contents.push("END:VALARM");
      });
      contents.push("END:VEVENT");
    });
    contents.push("END:VCALENDAR");

    const blob = new Blob([contents.join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast("Calendar downloaded with all 3 reminders for each function.");
  }

  function formatIcsUtc(date) {
    return date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) + "T" +
      pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + "Z";
  }

  function escapeIcs(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }

  function safeFileName(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ibi-function";
  }

  function localDate(dateValue, timeValue) {
    if (!dateValue || !timeValue) {
      return null;
    }
    const dateParts = dateValue.split("-").map(Number);
    const timeParts = timeValue.split(":").map(Number);
    return new Date(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1], 0, 0);
  }

  function formatFunctionDate(date) {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function pad(number) {
    return String(number).padStart(2, "0");
  }

  async function installApp() {
    if (!installPrompt) {
      return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    elements.installButton.hidden = true;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(function () {
      elements.toast.hidden = true;
    }, 4200);
  }
}());
