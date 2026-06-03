(function () {
  "use strict";

  const APP_VERSION = "v2";
  const STORAGE_KEY = "ibi-function-reminder-data-v1";
  const CARD_DB_NAME = "ibi-function-reminder-cards";
  const CARD_STORE_NAME = "cards";
  const ALARM_GRACE_MS = 15 * 60 * 1000;
  const AI_DEFAULT_MODELS = {
    local: "Local OCR",
    gemini: "gemini-3.5-flash",
    openai: "gpt-4.1-mini",
    claude: "claude-sonnet-4-20250514"
  };
  const defaultState = {
    events: [],
    settings: {
      alarmsEnabled: true,
      soundEnabled: true,
      aiProvider: "local",
      aiModels: AI_DEFAULT_MODELS,
      aiKeys: {}
    },
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
  let cardDbPromise = null;
  let activeCardRecord = null;
  let activeCardUrl = null;

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
    aiProvider: document.getElementById("aiProvider"),
    aiModel: document.getElementById("aiModel"),
    aiApiKey: document.getElementById("aiApiKey"),
    saveAiSettingsButton: document.getElementById("saveAiSettingsButton"),
    clearAiKeyButton: document.getElementById("clearAiKeyButton"),
    aiSecurityNote: document.getElementById("aiSecurityNote"),
    form: document.getElementById("eventForm"),
    eventName: document.getElementById("eventName"),
    eventDate: document.getElementById("eventDate"),
    eventTime: document.getElementById("eventTime"),
    eventVenue: document.getElementById("eventVenue"),
    eventNotes: document.getElementById("eventNotes"),
    saveEventButton: document.getElementById("saveEventButton"),
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
    cardModal: document.getElementById("cardModal"),
    cardModalTitle: document.getElementById("cardModalTitle"),
    storedCardImage: document.getElementById("storedCardImage"),
    closeCardButton: document.getElementById("closeCardButton"),
    downloadCardButton: document.getElementById("downloadCardButton"),
    toast: document.getElementById("toast"),
    installButton: document.getElementById("installButton")
  };

  initialize();

  function initialize() {
    elements.appVersion.textContent = APP_VERSION;
    elements.alarmsToggle.checked = state.settings.alarmsEnabled;
    elements.soundToggle.checked = state.settings.soundEnabled;
    elements.aiProvider.value = state.settings.aiProvider || "local";
    updateAiProviderUI();
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
    elements.aiProvider.addEventListener("change", updateAiProviderFromSelection);
    elements.saveAiSettingsButton.addEventListener("click", saveAiSettings);
    elements.clearAiKeyButton.addEventListener("click", clearAiKey);
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
    elements.closeCardButton.addEventListener("click", closeCardModal);
    elements.downloadCardButton.addEventListener("click", downloadActiveCard);
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
        return cloneDefaultState();
      }
      return {
        events: Array.isArray(stored.events) ? stored.events : [],
        settings: mergeSettings(stored.settings),
        triggered: stored.triggered || {},
        snoozes: Array.isArray(stored.snoozes) ? stored.snoozes : []
      };
    } catch (error) {
      return cloneDefaultState();
    }
  }

  function cloneDefaultState() {
    return JSON.parse(JSON.stringify(defaultState));
  }

  function mergeSettings(savedSettings) {
    const settings = Object.assign({}, defaultState.settings, savedSettings || {});
    settings.aiModels = Object.assign({}, AI_DEFAULT_MODELS, settings.aiModels || {});
    settings.aiKeys = Object.assign({}, settings.aiKeys || {});
    return settings;
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function updateAiProviderFromSelection() {
    const provider = elements.aiProvider.value;
    state.settings.aiProvider = provider;
    updateAiProviderUI();
    persist();
  }

  function updateAiProviderUI() {
    const provider = elements.aiProvider.value || state.settings.aiProvider || "local";
    const model = state.settings.aiModels[provider] || AI_DEFAULT_MODELS[provider] || "";
    elements.aiModel.value = model;
    elements.aiModel.disabled = provider === "local";
    elements.aiApiKey.value = state.settings.aiKeys[provider] || "";
    elements.aiApiKey.disabled = provider === "local";
    elements.clearAiKeyButton.disabled = provider === "local";
    if (provider === "local") {
      elements.aiSecurityNote.textContent = "Local OCR does not send the card image to any AI provider. It is private, but less accurate on decorative invitation cards.";
    } else {
      elements.aiSecurityNote.textContent = "Your card image is sent to " + providerName(provider) + " for extraction. Do not hard-code API keys in GitHub files; save your own key only on this device.";
    }
  }

  function saveAiSettings() {
    const provider = elements.aiProvider.value;
    state.settings.aiProvider = provider;
    state.settings.aiModels[provider] = elements.aiModel.value.trim() || AI_DEFAULT_MODELS[provider];
    if (provider !== "local") {
      state.settings.aiKeys[provider] = elements.aiApiKey.value.trim();
    }
    persist();
    updateAiProviderUI();
    showToast("AI extraction settings saved on this device.");
  }

  function clearAiKey() {
    const provider = elements.aiProvider.value;
    if (provider !== "local") {
      delete state.settings.aiKeys[provider];
      elements.aiApiKey.value = "";
      persist();
      showToast(providerName(provider) + " API key cleared from this browser.");
    }
  }

  function providerName(provider) {
    return { gemini: "Gemini", openai: "OpenAI", claude: "Claude", local: "Local OCR" }[provider] || provider;
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

    try {
      if ((state.settings.aiProvider || "local") === "local") {
        await extractWithLocalOcr();
      } else {
        await extractWithAiProvider();
      }
    } catch (error) {
      if ((state.settings.aiProvider || "local") !== "local") {
        showToast("AI extraction failed. Trying local OCR as fallback.");
        try {
          await extractWithLocalOcr();
        } catch (fallbackError) {
          setProgress(0, "Could not read this card");
          showToast("Extraction failed. Please enter the details manually.");
        }
      } else {
        setProgress(0, "Could not read this card");
        showToast("This card could not be read clearly. Please enter the details manually.");
      }
    } finally {
      elements.extractButton.disabled = false;
    }
  }

  async function extractWithLocalOcr() {
    setProgress(4, "Loading text reader...");
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
  }

  async function extractWithAiProvider() {
    const provider = state.settings.aiProvider;
    const apiKey = (state.settings.aiKeys && state.settings.aiKeys[provider]) || elements.aiApiKey.value.trim();
    if (!apiKey) {
      throw new Error("Missing API key");
    }
    state.settings.aiModels[provider] = elements.aiModel.value.trim() || AI_DEFAULT_MODELS[provider];
    persist();
    setProgress(10, "Preparing card for " + providerName(provider) + "...");
    const image = await fileToAiImage(selectedImage);
    setProgress(30, "Asking " + providerName(provider) + " to extract details...");
    const rawDetails = await callAiProvider(provider, image, apiKey);
    const details = normalizeAiDetails(rawDetails);
    fillForm(details);
    setProgress(100, providerName(provider) + " extraction complete");
    showToast(details.date && details.time ? "AI details extracted. Please review before saving." : "AI extracted partial details. Please review missing fields.");
  }

  async function callAiProvider(provider, image, apiKey) {
    if (provider === "gemini") {
      return callGemini(image, apiKey);
    }
    if (provider === "openai") {
      return callOpenAi(image, apiKey);
    }
    if (provider === "claude") {
      return callClaude(image, apiKey);
    }
    throw new Error("Unknown AI provider");
  }

  function extractionPrompt() {
    return [
      "You are extracting exact event information from an invitation card image.",
      "Return only JSON with these keys:",
      "function_name, date, time, venue, notes, confidence.",
      "Rules:",
      "- date must be YYYY-MM-DD.",
      "- time must be HH:mm in 24-hour format.",
      "- venue should include hall/building and address if visible.",
      "- notes should include hosts, phone numbers, landmarks or uncertain OCR clues.",
      "- If a field is not visible, use an empty string.",
      "- Do not invent missing details.",
      "Current date for context: " + new Date().toISOString().slice(0, 10) + "."
    ].join("\n");
  }

  async function callGemini(image, apiKey) {
    const model = state.settings.aiModels.gemini || AI_DEFAULT_MODELS.gemini;
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: image.mimeType, data: image.base64 } },
            { text: extractionPrompt() }
          ]
        }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    const data = await readJsonResponse(response);
    return parseAiJson(data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0].text);
  }

  async function callOpenAi(image, apiKey) {
    const model = state.settings.aiModels.openai || AI_DEFAULT_MODELS.openai;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: extractionPrompt() + "\nReturn valid JSON only." },
            { type: "input_image", image_url: image.dataUrl, detail: "high" }
          ]
        }],
        text: { format: { type: "json_object" } },
        max_output_tokens: 900
      })
    });
    const data = await readJsonResponse(response);
    return parseAiJson(extractOpenAiText(data));
  }

  async function callClaude(image, apiKey) {
    const model = state.settings.aiModels.claude || AI_DEFAULT_MODELS.claude;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 900,
        system: "Return only JSON. Do not include markdown fences or commentary.",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } },
            { type: "text", text: extractionPrompt() }
          ]
        }]
      })
    });
    const data = await readJsonResponse(response);
    const textBlock = data.content && data.content.find(function (part) { return part.type === "text"; });
    return parseAiJson(textBlock && textBlock.text);
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      data = { error: { message: text } };
    }
    if (!response.ok) {
      const message = data.error && (data.error.message || data.error.status) ? (data.error.message || data.error.status) : "API request failed";
      throw new Error(message);
    }
    return data;
  }

  function extractOpenAiText(data) {
    if (data.output_text) {
      return data.output_text;
    }
    const textParts = [];
    (data.output || []).forEach(function (item) {
      (item.content || []).forEach(function (content) {
        if (content.type === "output_text" && content.text) {
          textParts.push(content.text);
        }
      });
    });
    return textParts.join("\n");
  }

  function parseAiJson(text) {
    if (!text) {
      throw new Error("AI response did not include text");
    }
    const cleaned = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new Error("AI response was not JSON");
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  function normalizeAiDetails(details) {
    const name = details.function_name || details.functionName || details.name || "";
    const date = normalizeDate(details.date || "");
    const time = normalizeTime(details.time || "");
    const venue = details.venue || details.location || "";
    const noteParts = [];
    if (details.notes) {
      noteParts.push(details.notes);
    }
    if (details.confidence !== undefined && details.confidence !== "") {
      noteParts.push("AI confidence: " + details.confidence);
    }
    return {
      name: name,
      date: date,
      time: time,
      venue: venue,
      notes: noteParts.join("\n")
    };
  }

  function normalizeDate(value) {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }
    return findDate(text);
  }

  function normalizeTime(value) {
    const text = String(value || "").trim();
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
      return text;
    }
    return findTime(text);
  }

  async function fileToAiImage(file) {
    const dataUrl = await readFileAsDataUrl(file);
    return {
      dataUrl: dataUrl,
      base64: dataUrl.split(",")[1],
      mimeType: file.type || "image/jpeg"
    };
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(reader.error);
      };
      reader.readAsDataURL(file);
    });
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

  async function saveEvent(event) {
    event.preventDefault();
    const functionDate = localDate(elements.eventDate.value, elements.eventTime.value);
    if (!functionDate || Number.isNaN(functionDate.getTime())) {
      showToast("Please enter a valid function date and start time.");
      return;
    }

    elements.saveEventButton.disabled = true;
    const savedEvent = {
      id: generateId(),
      name: elements.eventName.value.trim(),
      date: elements.eventDate.value,
      time: elements.eventTime.value,
      venue: elements.eventVenue.value.trim(),
      notes: elements.eventNotes.value.trim(),
      createdAt: new Date().toISOString(),
      attendedAt: null,
      hasCardImage: Boolean(selectedImage),
      cardName: selectedImage ? selectedImage.name || "invitation-card.jpg" : ""
    };

    if (selectedImage) {
      try {
        await saveCardCopy(savedEvent.id, selectedImage);
      } catch (error) {
        savedEvent.hasCardImage = false;
        showToast("Function saved, but the scanned card copy could not be stored.");
      }
    }
    state.events.push(savedEvent);
    persist();
    render();
    clearForm();
    prepareAudio();
    elements.saveEventButton.disabled = false;
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
      hydrateStoredCardPreview(event);
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
    article.querySelector('[data-field="cardBlock"]').hidden = !event.hasCardImage;
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
    } else if (button.dataset.action === "viewCard") {
      viewStoredCard(savedEvent);
    } else if (button.dataset.action === "delete") {
      state.events = state.events.filter(function (item) { return item.id !== eventId; });
      state.snoozes = state.snoozes.filter(function (item) { return item.eventId !== eventId; });
      deleteCardCopy(eventId);
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
    clearCardCopies();
    state = cloneDefaultState();
    elements.alarmsToggle.checked = true;
    elements.soundToggle.checked = true;
    elements.aiProvider.value = state.settings.aiProvider;
    updateAiProviderUI();
    cancelClear();
    render();
    clearForm();
    showToast("All saved function details and reminders have been erased.");
  }

  async function openCardDatabase() {
    if (!("indexedDB" in window)) {
      throw new Error("IndexedDB is not available");
    }
    if (cardDbPromise) {
      return cardDbPromise;
    }
    cardDbPromise = new Promise(function (resolve, reject) {
      const request = indexedDB.open(CARD_DB_NAME, 1);
      request.onupgradeneeded = function () {
        request.result.createObjectStore(CARD_STORE_NAME, { keyPath: "eventId" });
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
    return cardDbPromise;
  }

  async function saveCardCopy(eventId, file) {
    const db = await openCardDatabase();
    const blob = await resizeCardImage(file);
    const record = {
      eventId: eventId,
      blob: blob,
      name: file.name || "invitation-card.jpg",
      mimeType: blob.type || file.type || "image/jpeg",
      savedAt: new Date().toISOString()
    };
    return writeCardRecord(db, record);
  }

  function writeCardRecord(db, record) {
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction(CARD_STORE_NAME, "readwrite");
      transaction.objectStore(CARD_STORE_NAME).put(record);
      transaction.oncomplete = resolve;
      transaction.onerror = function () {
        reject(transaction.error);
      };
    });
  }

  async function getCardCopy(eventId) {
    const db = await openCardDatabase();
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction(CARD_STORE_NAME, "readonly");
      const request = transaction.objectStore(CARD_STORE_NAME).get(eventId);
      request.onsuccess = function () {
        resolve(request.result || null);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  async function deleteCardCopy(eventId) {
    try {
      const db = await openCardDatabase();
      const transaction = db.transaction(CARD_STORE_NAME, "readwrite");
      transaction.objectStore(CARD_STORE_NAME).delete(eventId);
    } catch (error) {
      // Missing image storage should never block deleting an event.
    }
  }

  async function clearCardCopies() {
    try {
      const db = await openCardDatabase();
      const transaction = db.transaction(CARD_STORE_NAME, "readwrite");
      transaction.objectStore(CARD_STORE_NAME).clear();
    } catch (error) {
      // Missing image storage should never block clearing app data.
    }
  }

  async function resizeCardImage(file) {
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(dataUrl);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, width, height);
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        resolve(blob || file);
      }, "image/jpeg", 0.86);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      const image = new Image();
      image.onload = function () {
        resolve(image);
      };
      image.onerror = reject;
      image.src = src;
    });
  }

  async function hydrateStoredCardPreview(event) {
    if (!event.hasCardImage) {
      return;
    }
    try {
      const record = await getCardCopy(event.id);
      if (!record) {
        return;
      }
      const article = Array.from(elements.eventList.querySelectorAll(".event-card")).find(function (card) {
        return card.dataset.eventId === event.id;
      });
      if (!article) {
        return;
      }
      const block = article.querySelector('[data-field="cardBlock"]');
      const image = article.querySelector('[data-field="cardThumb"]');
      image.src = URL.createObjectURL(record.blob);
      block.hidden = false;
    } catch (error) {
      // Card previews are helpful, not required for the reminder list to render.
    }
  }

  async function viewStoredCard(event) {
    try {
      const record = await getCardCopy(event.id);
      if (!record) {
        showToast("No scanned card copy was found for this function.");
        return;
      }
      closeCardModal();
      activeCardRecord = record;
      activeCardUrl = URL.createObjectURL(record.blob);
      elements.cardModalTitle.textContent = event.name;
      elements.storedCardImage.src = activeCardUrl;
      elements.cardModal.hidden = false;
    } catch (error) {
      showToast("Could not open the saved scanned card.");
    }
  }

  function closeCardModal() {
    elements.cardModal.hidden = true;
    elements.storedCardImage.removeAttribute("src");
    if (activeCardUrl) {
      URL.revokeObjectURL(activeCardUrl);
      activeCardUrl = null;
    }
    activeCardRecord = null;
  }

  function downloadActiveCard() {
    if (!activeCardRecord) {
      return;
    }
    const url = URL.createObjectURL(activeCardRecord.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = activeCardRecord.name || "invitation-card.jpg";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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
    showReminderNotification(reminder);
  }

  async function showReminderNotification(reminder) {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      return;
    }
    const options = {
      body: reminder.event.name + " - " + reminder.label,
      icon: "icons/app-icon.svg",
      badge: "icons/app-icon.svg",
      tag: reminder.id,
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [400, 180, 400, 180, 700],
      data: { eventId: reminder.event.id || "", url: location.href }
    };
    try {
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification("IBI Function Reminder", options);
      } else {
        new Notification("IBI Function Reminder", options);
      }
    } catch (error) {
      new Notification("IBI Function Reminder", options);
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
