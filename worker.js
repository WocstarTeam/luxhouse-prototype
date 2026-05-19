globalThis.BOOKINGS = globalThis.BOOKINGS || {};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const STATUS_MESSAGES = {
  pending_verification:
    "Thank you for submitting your documents. Stripe is processing your verification now. This usually completes within a few minutes.",
  verified:
    "Congratulations, we have successfully confirmed your Identity, you are now being redirected to the booking page.",
  requires_input:
    "Thank you for submitting your documents. Stripe is processing your verification now. This usually completes within a few minutes.",
  rejected:
    "Verification could not be completed. Please contact support.",
  approved:
    "Your request has been approved. Our team will contact you with the next steps.",
  unknown:
    "Thank you. Your booking request is being reviewed by our team.",
};
const MIN_STAY_NIGHTS = 2;
const MAX_STAY_NIGHTS = 28;
const PINE_ENABLED = false;
const PINE_COMING_SOON_MESSAGE =
  "Pine & Peace House is opening soon. Please book Cactus & Chill House for now.";

let BOOKINGS = globalThis.BOOKINGS;
globalThis.ICAL_EVENTS_CACHE = globalThis.ICAL_EVENTS_CACHE || {};
const ICAL_CACHE_TTL_MS = 5 * 60 * 1000;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/plain",
    },
  });
}

function createRequestId() {
  return `LUX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function parseIsoDateToUtcMs(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return NaN;
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function calculateStayNights(checkin, checkout) {
  const startMs = parseIsoDateToUtcMs(checkin);
  const endMs = parseIsoDateToUtcMs(checkout);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return NaN;
  }
  return Math.round((endMs - startMs) / 86400000);
}

function getStayRangeError(checkin, checkout) {
  const nights = calculateStayNights(checkin, checkout);
  if (!Number.isFinite(nights)) {
    return "Invalid date range";
  }
  if (nights < MIN_STAY_NIGHTS) {
    return `The minimum stay is ${MIN_STAY_NIGHTS} nights.`;
  }
  if (nights > MAX_STAY_NIGHTS) {
    return `The maximum stay is ${MAX_STAY_NIGHTS} nights.`;
  }
  return "";
}

function parseIcalDateValueToUtcMs(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return NaN;
  }

  const dateOnly = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) {
    return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }

  const utcDateTime = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utcDateTime) {
    return Date.UTC(
      Number(utcDateTime[1]),
      Number(utcDateTime[2]) - 1,
      Number(utcDateTime[3]),
      Number(utcDateTime[4]),
      Number(utcDateTime[5]),
      Number(utcDateTime[6])
    );
  }

  const localDateTime = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (localDateTime) {
    return Date.UTC(
      Number(localDateTime[1]),
      Number(localDateTime[2]) - 1,
      Number(localDateTime[3]),
      Number(localDateTime[4]),
      Number(localDateTime[5]),
      Number(localDateTime[6])
    );
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function rangesOverlapExclusive(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function normalizeAvailabilityDestination(value) {
  const raw = String(value || "").toLowerCase().trim();
  if (raw.includes("pine")) {
    return "pine";
  }
  if (raw.includes("cactus")) {
    return "cactus";
  }
  return "";
}

function isTemporarilyUnavailableDestination(value) {
  const normalized = normalizeAvailabilityDestination(value);
  return normalized === "pine" && !PINE_ENABLED;
}

function unfoldIcalLines(text) {
  return String(text || "")
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/);
}

function getIcalPropertyValue(line, propertyName) {
  if (!line || !propertyName) {
    return "";
  }
  const startsWithName = line.startsWith(propertyName + ":") || line.startsWith(propertyName + ";");
  if (!startsWithName) {
    return "";
  }
  const separatorIndex = line.indexOf(":");
  if (separatorIndex < 0) {
    return "";
  }
  return line.slice(separatorIndex + 1).trim();
}

function parseFreebusyPeriods(rawValue) {
  const periods = [];
  const chunks = String(rawValue || "")
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const period of chunks) {
    const parts = period.split("/");
    if (parts.length !== 2) {
      continue;
    }
    const startMs = parseIcalDateValueToUtcMs(parts[0]);
    const endMs = parseIcalDateValueToUtcMs(parts[1]);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      periods.push({ startMs, endMs });
    }
  }

  return periods;
}

function parseIcalBusyRanges(icalText) {
  const lines = unfoldIcalLines(icalText);
  const ranges = [];
  let currentEventStart = "";
  let currentEventEnd = "";
  let inEvent = false;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      currentEventStart = "";
      currentEventEnd = "";
      continue;
    }

    if (line === "END:VEVENT") {
      if (inEvent) {
        const startMs = parseIcalDateValueToUtcMs(currentEventStart);
        const endMsRaw = parseIcalDateValueToUtcMs(currentEventEnd);
        const endMs = Number.isFinite(endMsRaw) ? endMsRaw : startMs + 24 * 60 * 60 * 1000;
        if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
          ranges.push({ startMs, endMs });
        }
      }
      inEvent = false;
      continue;
    }

    if (inEvent) {
      const dtstartValue = getIcalPropertyValue(line, "DTSTART");
      if (dtstartValue) {
        currentEventStart = dtstartValue;
        continue;
      }

      const dtendValue = getIcalPropertyValue(line, "DTEND");
      if (dtendValue) {
        currentEventEnd = dtendValue;
      }
      continue;
    }

    const freebusyValue = getIcalPropertyValue(line, "FREEBUSY");
    if (freebusyValue) {
      ranges.push(...parseFreebusyPeriods(freebusyValue));
    }
  }

  return ranges;
}

function collectIcalUrls(env, destination) {
  const values = [];

  const pushValue = (value) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (trimmed) {
      values.push(trimmed);
    }
  };

  const destinationKey = normalizeAvailabilityDestination(destination);
  if (destinationKey === "pine") {
    pushValue(env.HOSPITABLE_ICAL_URL_PINE);
    pushValue(env.PINE_ICAL_URL);
    pushValue(env.ICAL_URL_PINE);
  } else if (destinationKey === "cactus") {
    pushValue(env.HOSPITABLE_ICAL_URL_CACTUS);
    pushValue(env.CACTUS_ICAL_URL);
    pushValue(env.ICAL_URL_CACTUS);
  }

  pushValue(env.HOSPITABLE_ICAL_URL);
  pushValue(env.HOSPITABLE_ICAL);
  pushValue(env.ICAL_URL);

  if (typeof env.HOSPITABLE_ICAL_URLS === "string") {
    env.HOSPITABLE_ICAL_URLS
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((url) => values.push(url));
  }

  return Array.from(new Set(values));
}

async function getBusyRangesFromIcalUrl(url) {
  const cacheKey = String(url || "").trim();
  if (!cacheKey) {
    return [];
  }

  const now = Date.now();
  const cached = globalThis.ICAL_EVENTS_CACHE[cacheKey];
  if (cached && Array.isArray(cached.ranges) && cached.expiresAt > now) {
    return cached.ranges;
  }

  const response = await fetch(cacheKey, {
    headers: { Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.8" },
  });

  if (!response.ok) {
    throw new Error(`iCal fetch failed (${response.status})`);
  }

  const text = await response.text();
  const ranges = parseIcalBusyRanges(text);
  globalThis.ICAL_EVENTS_CACHE[cacheKey] = {
    ranges,
    expiresAt: now + ICAL_CACHE_TTL_MS,
  };

  return ranges;
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function parseStripeResponseBody(response) {
  const raw = await response.text();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function extractStripeErrorMessage(stripeData, fallbackMessage) {
  if (stripeData && stripeData.error && typeof stripeData.error.message === "string") {
    const message = stripeData.error.message.trim();
    if (message) {
      return message;
    }
  }
  if (stripeData && typeof stripeData.raw === "string") {
    const message = stripeData.raw.trim();
    if (message) {
      return message;
    }
  }
  return fallbackMessage;
}

function detectStripeKeyKind(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) {
    return "missing";
  }
  if (key.startsWith("sk_live_")) {
    return "secret_live";
  }
  if (key.startsWith("sk_test_")) {
    return "secret_test";
  }
  if (key.startsWith("pk_live_")) {
    return "publishable_live";
  }
  if (key.startsWith("pk_test_")) {
    return "publishable_test";
  }
  if (key.startsWith("rk_live_")) {
    return "restricted_live";
  }
  if (key.startsWith("rk_test_")) {
    return "restricted_test";
  }
  return "unknown";
}

function detectStripeModeFromKeyKind(kind) {
  if (String(kind).endsWith("_live")) {
    return "live";
  }
  if (String(kind).endsWith("_test")) {
    return "test";
  }
  return "unknown";
}

function maskStripeKey(key) {
  const raw = String(key || "").trim();
  if (!raw) {
    return "";
  }
  if (raw.length <= 12) {
    return `${raw.slice(0, 4)}...`;
  }
  return `${raw.slice(0, 7)}...${raw.slice(-4)}`;
}

function maskIdentifier(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (raw.length <= 10) {
    return `${raw.slice(0, 4)}...`;
  }
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function getStripeSecretKey(env) {
  return typeof env.STRIPE_SECRET_KEY === "string" ? env.STRIPE_SECRET_KEY.trim() : "";
}

function getBookingRequestRecipient(env) {
  const candidates = [
    env.BOOKING_REQUEST_RECIPIENT,
    env.BOOKING_EMAIL_TO,
    env.EMAIL_TO,
  ];
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (value) {
      return value;
    }
  }
  return "info@wocstar.com";
}

function getBookingEmailSender(env) {
  const candidates = [
    env.BOOKING_EMAIL_FROM,
    env.EMAIL_FROM,
    env.RESEND_FROM_EMAIL,
  ];
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (value) {
      return value;
    }
  }
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeEmailLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "$0";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBookingAddons(rawAddons) {
  if (typeof rawAddons === "string") {
    const trimmed = rawAddons.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeBookingAddons(parsed);
    } catch {
      return [{ name: trimmed, price: 0 }];
    }
  }

  if (!Array.isArray(rawAddons)) {
    return [];
  }

  const normalized = [];
  for (const item of rawAddons) {
    if (typeof item === "string") {
      const name = normalizeEmailLine(item);
      if (name) {
        normalized.push({ name, price: 0 });
      }
      continue;
    }

    if (!item || typeof item !== "object") {
      continue;
    }

    const name = normalizeEmailLine(item.name || item.label || item.title || "Selected add-on");
    if (!name) {
      continue;
    }

    normalized.push({
      name,
      price: toFiniteNumber(item.price ?? item.amount ?? item.total, 0),
    });
  }

  return normalized;
}

function normalizeStripeIdReference(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id.trim();
  }
  return "";
}

function getVerificationReportIdFromStripeData(stripeData) {
  if (!stripeData || typeof stripeData !== "object") {
    return "";
  }
  return normalizeStripeIdReference(stripeData.last_verification_report);
}

async function stripeJsonRequest(env, path, options = {}) {
  const stripeSecretKey = getStripeSecretKey(env);
  const stripeKeyKind = detectStripeKeyKind(stripeSecretKey);
  if (!stripeSecretKey || stripeKeyKind.startsWith("publishable_")) {
    return {
      ok: false,
      status: 500,
      data: { error: { message: "Stripe secret key is not configured for server-side identity access." } },
    };
  }

  const response = await fetch(`https://api.stripe.com${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: options.body || undefined,
  });
  const data = await parseStripeResponseBody(response);
  return {
    ok: response.ok,
    status: response.status,
    data,
    requestId: response.headers.get("request-id") || response.headers.get("Request-Id") || null,
  };
}

async function retrieveStripeVerificationSession(env, sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) {
    return null;
  }
  const result = await stripeJsonRequest(
    env,
    `/v1/identity/verification_sessions/${encodeURIComponent(id)}`
  );
  if (!result.ok) {
    console.error({
      event: "stripe_identity_session_retrieve_failed",
      stripeStatus: result.status,
      stripeRequestId: result.requestId,
      stripeVerificationSessionId: maskIdentifier(id),
      stripeError: result.data && result.data.error ? result.data.error : null,
    });
    return null;
  }
  return result.data;
}

async function retrieveStripeVerificationReport(env, reportId) {
  const id = String(reportId || "").trim();
  if (!id) {
    return null;
  }
  const result = await stripeJsonRequest(
    env,
    `/v1/identity/verification_reports/${encodeURIComponent(id)}`
  );
  if (!result.ok) {
    console.error({
      event: "stripe_identity_report_retrieve_failed",
      stripeStatus: result.status,
      stripeRequestId: result.requestId,
      stripeVerificationReportId: maskIdentifier(id),
      stripeError: result.data && result.data.error ? result.data.error : null,
    });
    return null;
  }
  return result.data;
}

function labelStripeIdentityFile(pathSegments) {
  const path = pathSegments.join(".").toLowerCase();
  if (path.includes("selfie")) {
    return "Selfie photo";
  }
  if (path.includes("front")) {
    return "ID front photo";
  }
  if (path.includes("back")) {
    return "ID back photo";
  }
  if (path.includes("document")) {
    return "ID document photo";
  }
  return "Stripe identity file";
}

function collectStripeFileReferences(value, pathSegments = [], refs = [], seen = new Set()) {
  if (!value) {
    return refs;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("file_") && !seen.has(trimmed)) {
      seen.add(trimmed);
      refs.push({
        fileId: trimmed,
        label: labelStripeIdentityFile(pathSegments),
      });
    }
    return refs;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectStripeFileReferences(item, [...pathSegments, String(index)], refs, seen);
    });
    return refs;
  }

  if (typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      collectStripeFileReferences(nestedValue, [...pathSegments, key], refs, seen);
    }
  }

  return refs;
}

async function createStripeFileLink(env, fileId) {
  const params = new URLSearchParams();
  params.set("file", fileId);
  params.set("expires_at", String(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60));

  const result = await stripeJsonRequest(env, "/v1/file_links", {
    method: "POST",
    body: params.toString(),
  });
  if (!result.ok) {
    console.error({
      event: "stripe_file_link_create_failed",
      stripeStatus: result.status,
      stripeRequestId: result.requestId,
      stripeFileId: maskIdentifier(fileId),
      stripeError: result.data && result.data.error ? result.data.error : null,
    });
    return null;
  }
  return result.data;
}

async function collectIdentityArtifacts(env, booking) {
  const artifacts = {
    sessionId: getStoredStripeVerificationSessionId(booking),
    reportId: normalizeStripeIdReference(booking && booking.stripeVerificationReportId),
    status: normalizeEmailLine((booking && (booking.identityStatus || booking.status)) || "verified"),
    links: [],
  };

  const session = artifacts.sessionId
    ? await retrieveStripeVerificationSession(env, artifacts.sessionId)
    : null;
  if (session) {
    artifacts.status = normalizeEmailLine(session.status || artifacts.status);
    artifacts.reportId = artifacts.reportId || getVerificationReportIdFromStripeData(session);
  }

  const report = artifacts.reportId
    ? await retrieveStripeVerificationReport(env, artifacts.reportId)
    : null;
  if (!report) {
    return artifacts;
  }

  const fileRefs = collectStripeFileReferences(report).slice(0, 8);
  for (const ref of fileRefs) {
    const fileLink = await createStripeFileLink(env, ref.fileId);
    if (!fileLink || typeof fileLink.url !== "string" || !fileLink.url) {
      continue;
    }
    artifacts.links.push({
      label: ref.label,
      fileId: ref.fileId,
      url: fileLink.url,
      expiresAt: fileLink.expires_at || null,
    });
  }

  return artifacts;
}

function buildBookingRequestEmail(booking, artifacts) {
  const addons = normalizeBookingAddons(booking.addons);
  const nights =
    toFiniteNumber(booking.nights, 0) ||
    toFiniteNumber(calculateStayNights(booking.checkin, booking.checkout), 0);
  const nightlyRate = toFiniteNumber(booking.nightlyRate, 0);
  const staySubtotal = nights > 0 && nightlyRate > 0 ? nights * nightlyRate : 0;
  const addonsTotal = addons.reduce((sum, addon) => sum + toFiniteNumber(addon.price, 0), 0);
  const recordedAddonsTotal = toFiniteNumber(booking.addonsTotal, addonsTotal);
  const total =
    toFiniteNumber(booking.total, 0) ||
    staySubtotal + (recordedAddonsTotal || addonsTotal);
  const guestName = normalizeEmailLine(booking.guestName) || "Guest";
  const destinationLabel =
    normalizeEmailLine(booking.destinationLabel || booking.destination) || "LuxHouse Booking";
  const requestId = normalizeEmailLine(booking.requestId) || "N/A";
  const identityStatus = normalizeEmailLine(
    artifacts.status || booking.identityStatus || booking.status || "verified"
  );
  const subject = `New verified booking request: ${guestName} - ${destinationLabel}`;

  const detailRows = [
    ["Request ID", requestId],
    ["Property", destinationLabel],
    ["Check-in", booking.checkin || "N/A"],
    ["Check-out", booking.checkout || "N/A"],
    ["Nights", nights || "N/A"],
    ["Guests", booking.guests || "N/A"],
    ["Guest name", guestName],
    ["Guest email", booking.guestEmail || "N/A"],
    ["Guest phone", booking.guestPhone || "N/A"],
    ["Stripe identity status", identityStatus || "verified"],
    ["Stripe session ID", artifacts.sessionId || "N/A"],
    ["Stripe report ID", artifacts.reportId || "N/A"],
  ];

  const invoiceRows = [
    {
      label: nights && nightlyRate
        ? `${nights} night${nights === 1 ? "" : "s"} at ${formatMoney(nightlyRate)}`
        : "Stay subtotal",
      amount: staySubtotal,
    },
    ...addons.map((addon) => ({
      label: addon.name,
      amount: toFiniteNumber(addon.price, 0),
    })),
  ];

  if (addons.length === 0) {
    invoiceRows.push({
      label: "Add-ons",
      amount: 0,
      note: "No add-ons selected",
    });
  } else if (recordedAddonsTotal && recordedAddonsTotal !== addonsTotal) {
    invoiceRows.push({
      label: "Add-ons total",
      amount: recordedAddonsTotal,
    });
  }

  const identityLinksHtml = artifacts.links.length
    ? artifacts.links
        .map(
          (link) => `
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #eadfd4;">${escapeHtml(link.label)}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #eadfd4;">
                <a href="${escapeHtml(link.url)}" style="color:#6b3f1d;font-weight:700;">Open secure Stripe file</a>
                <div style="font-size:12px;color:#786f68;">${escapeHtml(link.fileId)}</div>
              </td>
            </tr>`
        )
        .join("")
    : `
            <tr>
              <td colspan="2" style="padding:10px 12px;border-bottom:1px solid #eadfd4;color:#786f68;">
                Stripe did not return downloadable document/selfie file links for this request.
              </td>
            </tr>`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f7f2ec;color:#1f160f;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:760px;margin:0 auto;padding:28px 18px;">
      <div style="background:#fff;border:1px solid #dec7af;border-radius:14px;overflow:hidden;">
        <div style="padding:24px 28px;background:#21150e;color:#fff;">
          <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#d7b994;">The LuxHouse Collection</div>
          <h1 style="margin:8px 0 0;font-size:26px;line-height:1.2;">New Verified Booking Request</h1>
          <p style="margin:8px 0 0;color:#eadfd4;">${escapeHtml(destinationLabel)} | ${escapeHtml(booking.checkin || "N/A")} to ${escapeHtml(booking.checkout || "N/A")}</p>
        </div>
        <div style="padding:24px 28px;">
          <h2 style="font-size:18px;margin:0 0 12px;">Booking Details</h2>
          <table style="width:100%;border-collapse:collapse;border:1px solid #eadfd4;">
            ${detailRows
              .map(
                ([label, value]) => `
                  <tr>
                    <th align="left" style="width:38%;padding:10px 12px;background:#fbf7f1;border-bottom:1px solid #eadfd4;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:#6b3f1d;">${escapeHtml(label)}</th>
                    <td style="padding:10px 12px;border-bottom:1px solid #eadfd4;">${escapeHtml(value)}</td>
                  </tr>`
              )
              .join("")}
          </table>

          <h2 style="font-size:18px;margin:24px 0 12px;">Invoice Summary</h2>
          <table style="width:100%;border-collapse:collapse;border:1px solid #eadfd4;">
            <thead>
              <tr>
                <th align="left" style="padding:10px 12px;background:#fbf7f1;border-bottom:1px solid #eadfd4;color:#6b3f1d;">Item</th>
                <th align="right" style="padding:10px 12px;background:#fbf7f1;border-bottom:1px solid #eadfd4;color:#6b3f1d;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${invoiceRows
                .map(
                  (row) => `
                    <tr>
                      <td style="padding:10px 12px;border-bottom:1px solid #eadfd4;">${escapeHtml(row.note || row.label)}</td>
                      <td align="right" style="padding:10px 12px;border-bottom:1px solid #eadfd4;">${escapeHtml(formatMoney(row.amount))}</td>
                    </tr>`
                )
                .join("")}
              <tr>
                <td style="padding:12px;font-weight:700;background:#fbf7f1;">Total</td>
                <td align="right" style="padding:12px;font-weight:700;background:#fbf7f1;">${escapeHtml(formatMoney(total))}</td>
              </tr>
            </tbody>
          </table>

          <h2 style="font-size:18px;margin:24px 0 12px;">Stripe Identity Files</h2>
          <p style="margin:0 0 10px;color:#5c5149;">These links are generated from Stripe Identity and expire in 7 days.</p>
          <table style="width:100%;border-collapse:collapse;border:1px solid #eadfd4;">
            ${identityLinksHtml}
          </table>

          <h2 style="font-size:18px;margin:24px 0 12px;">Guest Notes</h2>
          <div style="white-space:pre-wrap;border:1px solid #eadfd4;background:#fbf7f1;padding:12px;border-radius:10px;">${escapeHtml(booking.notes || "No notes provided.")}</div>
        </div>
      </div>
    </div>
  </body>
</html>`;

  const addonLines = addons.length
    ? addons.map((addon) => `- ${addon.name}: ${formatMoney(addon.price)}`).join("\n")
    : "- No add-ons selected";
  const identityFileLines = artifacts.links.length
    ? artifacts.links.map((link) => `- ${link.label}: ${link.url}`).join("\n")
    : "- No downloadable Stripe identity file links were returned.";
  const text = [
    "New Verified Booking Request",
    "",
    ...detailRows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Invoice Summary",
    `Stay subtotal: ${formatMoney(staySubtotal)}`,
    "Add-ons:",
    addonLines,
    `Total: ${formatMoney(total)}`,
    "",
    "Stripe Identity Files",
    identityFileLines,
    "",
    "Guest Notes",
    booking.notes || "No notes provided.",
  ].join("\n");

  return { subject, html, text };
}

async function sendBookingRequestEmail(env, email, replyTo) {
  const apiKey = typeof env.RESEND_API_KEY === "string" ? env.RESEND_API_KEY.trim() : "";
  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      message: "Booking request email is not configured. Add RESEND_API_KEY to the Cloudflare Worker.",
      code: "email_missing_api_key",
    };
  }

  const from = getBookingEmailSender(env);
  if (!from) {
    return {
      ok: false,
      status: 500,
      message: "Booking request email sender is not configured. Add BOOKING_EMAIL_FROM or EMAIL_FROM to the Cloudflare Worker.",
      code: "email_missing_sender",
    };
  }

  const payload = {
    from,
    to: [getBookingRequestRecipient(env)],
    subject: email.subject,
    html: email.html,
    text: email.text,
  };
  if (replyTo) {
    payload.reply_to = replyTo;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message:
          data && data.message
            ? data.message
            : "Booking request email could not be sent.",
        code: "email_send_failed",
        data,
      };
    }
    return {
      ok: true,
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      message: error instanceof Error ? error.message : "Booking request email could not be sent.",
      code: "email_network_error",
    };
  }
}

function parseStripeSignatureHeader(signatureHeader) {
  const parsed = {
    timestamp: NaN,
    signatures: [],
  };
  const raw = String(signatureHeader || "").trim();
  if (!raw) {
    return parsed;
  }

  const chunks = raw.split(",");
  for (const chunk of chunks) {
    const separatorIndex = chunk.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = chunk.slice(0, separatorIndex).trim();
    const value = chunk.slice(separatorIndex + 1).trim();
    if (!value) {
      continue;
    }

    if (key === "t" && !Number.isFinite(parsed.timestamp)) {
      const timestamp = Number.parseInt(value, 10);
      if (Number.isFinite(timestamp)) {
        parsed.timestamp = timestamp;
      }
      continue;
    }

    if (key === "v1") {
      parsed.signatures.push(value);
    }
  }

  return parsed;
}

function timingSafeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

async function computeHmacSha256Hex(secret, payload) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(String(payload || ""))
  );
  return toHex(signatureBuffer);
}

async function verifyStripeWebhookSignature({
  rawBody,
  signatureHeader,
  endpointSecret,
  toleranceSeconds = 300,
}) {
  const parsedSignature = parseStripeSignatureHeader(signatureHeader);
  const hasTimestamp = Number.isFinite(parsedSignature.timestamp);
  const hasSignatures = Array.isArray(parsedSignature.signatures) && parsedSignature.signatures.length > 0;
  if (!hasTimestamp || !hasSignatures) {
    return { ok: false, reason: "missing_header_components" };
  }

  if (!endpointSecret) {
    return { ok: false, reason: "missing_webhook_secret" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const ageSeconds = Math.abs(nowSeconds - parsedSignature.timestamp);
  if (ageSeconds > toleranceSeconds) {
    return { ok: false, reason: "timestamp_out_of_tolerance", ageSeconds };
  }

  const signedPayload = `${parsedSignature.timestamp}.${String(rawBody || "")}`;
  const expectedSignature = await computeHmacSha256Hex(endpointSecret, signedPayload);
  const isValid = parsedSignature.signatures.some((candidate) =>
    timingSafeEqual(candidate, expectedSignature)
  );
  if (!isValid) {
    return { ok: false, reason: "signature_mismatch" };
  }

  return { ok: true };
}

function detectStripeModeFromEnv(env) {
  const keyKind = detectStripeKeyKind(getStripeSecretKey(env));
  return detectStripeModeFromKeyKind(keyKind);
}

function extractWebhookRequestId(eventDataObject) {
  if (!eventDataObject || typeof eventDataObject !== "object") {
    return "";
  }

  const metadataRequestId =
    eventDataObject.metadata &&
    typeof eventDataObject.metadata === "object" &&
    typeof eventDataObject.metadata.requestId === "string"
      ? eventDataObject.metadata.requestId.trim()
      : "";
  if (metadataRequestId) {
    return metadataRequestId;
  }

  const clientReferenceId =
    typeof eventDataObject.client_reference_id === "string"
      ? eventDataObject.client_reference_id.trim()
      : "";
  if (clientReferenceId) {
    return clientReferenceId;
  }

  return "";
}

function normalizeProcessedStripeEventKeys(rawKeys) {
  const normalized = [];
  const seen = new Set();
  const input = Array.isArray(rawKeys) ? rawKeys : [];
  for (const rawKey of input) {
    const key = String(rawKey || "").trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }
  const MAX_TRACKED_KEYS = 50;
  if (normalized.length > MAX_TRACKED_KEYS) {
    return normalized.slice(normalized.length - MAX_TRACKED_KEYS);
  }
  return normalized;
}

function buildStripeEventDedupKeys(event, eventType, eventDataObject) {
  const dedupKeys = [];
  const eventId =
    event && typeof event.id === "string"
      ? event.id.trim()
      : "";
  if (eventId) {
    dedupKeys.push(`evt:${eventId}`);
  }

  const objectId =
    eventDataObject && typeof eventDataObject.id === "string"
      ? eventDataObject.id.trim()
      : "";
  if (eventType && objectId) {
    dedupKeys.push(`obj:${eventType}:${objectId}`);
  }

  return dedupKeys;
}

async function loadExistingBooking(env, requestId) {
  const existingMemory =
    globalThis.BOOKINGS[requestId] && typeof globalThis.BOOKINGS[requestId] === "object"
      ? globalThis.BOOKINGS[requestId]
      : {};

  const kvStore =
    env &&
    env.BOOKINGS &&
    typeof env.BOOKINGS.get === "function" &&
    typeof env.BOOKINGS.put === "function"
      ? env.BOOKINGS
      : null;
  let existingKv = {};
  if (kvStore) {
    try {
      const raw = await kvStore.get(requestId);
      if (typeof raw === "string" && raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          existingKv = parsed;
        }
      }
    } catch (error) {
      console.error("Webhook KV read failed:", error);
    }
  }

  return {
    existingMemory,
    existingKv,
    kvStore,
  };
}

async function persistBookingFromWebhook(env, requestId, patch) {
  if (!requestId) {
    return null;
  }

  const { existingMemory, existingKv, kvStore } = await loadExistingBooking(env, requestId);
  const merged = {
    ...existingKv,
    ...existingMemory,
    ...patch,
    requestId,
    updatedAt: Date.now(),
  };

  globalThis.BOOKINGS[requestId] = merged;

  if (kvStore) {
    try {
      await kvStore.put(requestId, JSON.stringify(merged));
    } catch (error) {
      console.error("Webhook KV sync failed:", error);
    }
  }

  return merged;
}

function getStoredStripeVerificationSessionId(booking) {
  if (!booking || typeof booking !== "object") {
    return "";
  }

  const candidates = [
    booking.stripeVerificationSessionId,
    booking.identityVerificationSessionId,
    booking.verificationSessionId,
  ];
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (value) {
      return value;
    }
  }

  return "";
}

function mapStripeIdentityStatus(status, stripeData) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "verified") {
    return "verified";
  }
  if (normalized === "requires_input") {
    return "pending_verification";
  }
  if (normalized === "canceled" || normalized === "cancelled" || normalized === "rejected") {
    return "rejected";
  }
  return "pending_verification";
}

async function refreshBookingIdentityStatusFromStripe(env, requestId, booking) {
  if (!booking || typeof booking !== "object") {
    return booking;
  }

  const existingStatus = String(booking.status || "").trim().toLowerCase();
  if (
    existingStatus === "verified" ||
    existingStatus === "approved" ||
    existingStatus === "rejected"
  ) {
    return booking;
  }

  const verificationSessionId = getStoredStripeVerificationSessionId(booking);
  if (!verificationSessionId) {
    return booking;
  }

  const stripeSecretKey = getStripeSecretKey(env);
  const stripeKeyKind = detectStripeKeyKind(stripeSecretKey);
  if (!stripeSecretKey || stripeKeyKind.startsWith("publishable_")) {
    return booking;
  }

  try {
    const response = await fetch(
      `https://api.stripe.com/v1/identity/verification_sessions/${encodeURIComponent(verificationSessionId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
        },
      }
    );
    const stripeData = await parseStripeResponseBody(response);
    if (!response.ok) {
      console.error({
        event: "stripe_identity_status_refresh_failed",
        requestId,
        stripeVerificationSessionId: maskIdentifier(verificationSessionId),
        stripeStatus: response.status,
        stripeError: stripeData && stripeData.error ? stripeData.error : null,
      });
      return booking;
    }

    const stripeStatus = typeof stripeData.status === "string" ? stripeData.status.trim() : "";
    const mappedStatus = mapStripeIdentityStatus(stripeStatus, stripeData);
    const stripeVerificationReportId = getVerificationReportIdFromStripeData(stripeData);
    if (mappedStatus === "pending_verification") {
      return {
        ...booking,
        identityStatus: stripeStatus || booking.identityStatus || "pending_verification",
        stripeVerificationSessionId: verificationSessionId,
        stripeVerificationReportId:
          stripeVerificationReportId || booking.stripeVerificationReportId || null,
      };
    }

    const now = new Date().toISOString();
    const patch = {
      status: mappedStatus,
      identityStatus: mappedStatus,
      identityUpdatedAt: now,
      stripeVerificationSessionId: verificationSessionId,
      stripeVerificationReportId:
        stripeVerificationReportId || booking.stripeVerificationReportId || null,
    };
    if (mappedStatus === "verified") {
      patch.identityVerifiedAt = booking.identityVerifiedAt || now;
    }

    const refreshed = await persistBookingFromWebhook(env, requestId, patch);
    return refreshed || {
      ...booking,
      ...patch,
    };
  } catch (error) {
    console.error({
      event: "stripe_identity_status_refresh_error",
      requestId,
      stripeVerificationSessionId: maskIdentifier(verificationSessionId),
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return booking;
  }
}

function buildIdentityKeyDiagnostics(env) {
  const stripeSecretKey = getStripeSecretKey(env);
  const selectedKey = stripeSecretKey;
  const selectedKeySource = stripeSecretKey
    ? "STRIPE_SECRET_KEY"
    : "none";

  const fallbackKeyKind = detectStripeKeyKind(stripeSecretKey);
  const selectedKeyKind = detectStripeKeyKind(selectedKey);
  const fallbackMode = detectStripeModeFromKeyKind(fallbackKeyKind);
  const selectedMode = detectStripeModeFromKeyKind(selectedKeyKind);

  return {
    hasStripeSecretKey: Boolean(stripeSecretKey),
    fallbackKeyKind,
    fallbackMode,
    selectedKeySource,
    selectedKeyKind,
    selectedMode,
    selectedKeyPreview: maskStripeKey(selectedKey),
  };
}

function normalizeStatusForMessage(status) {
  const normalized = String(status || "").trim().toLowerCase();

  if (!normalized) {
    return "unknown";
  }

  if (normalized === "pending" || normalized === "pending_verification") {
    return "pending_verification";
  }

  if (normalized === "verified") {
    return "verified";
  }

  if (normalized === "requires_input") {
    return "requires_input";
  }

  if (normalized === "rejected") {
    return "rejected";
  }

  if (normalized === "approved") {
    return "approved";
  }

  return "unknown";
}

function getStatusMessage(status) {
  return STATUS_MESSAGES[normalizeStatusForMessage(status)] || STATUS_MESSAGES.unknown;
}

function formatUtcDateToIcalDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function addDaysUtc(value, daysToAdd) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setUTCDate(date.getUTCDate() + daysToAdd);
  return date;
}

function escapeIcalText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toSafeBookingRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function shouldIncludeInRequestCalendar(booking) {
  if (!booking) {
    return false;
  }

  const checkin = typeof booking.checkin === "string" ? booking.checkin.trim() : "";
  const checkout = typeof booking.checkout === "string" ? booking.checkout.trim() : "";
  if (!checkin || !checkout) {
    return false;
  }

  const status = String(booking.status || "").trim().toLowerCase();
  if (status === "rejected" || status === "requires_input") {
    return false;
  }

  const hasExplicitRequestMarker = Boolean(booking.bookingRequestedAt);
  const hasGuestDetails = Boolean(
    (typeof booking.guestName === "string" && booking.guestName.trim()) ||
      (typeof booking.guestEmail === "string" && booking.guestEmail.trim()) ||
      (typeof booking.guestPhone === "string" && booking.guestPhone.trim())
  );

  return hasExplicitRequestMarker || hasGuestDetails;
}

async function collectBookingsForCalendar(env) {
  const byRequestId = new Map();

  const memoryBookings = globalThis.BOOKINGS && typeof globalThis.BOOKINGS === "object" ? globalThis.BOOKINGS : {};
  for (const [requestId, value] of Object.entries(memoryBookings)) {
    const booking = toSafeBookingRecord(value);
    if (!booking) {
      continue;
    }
    const resolvedId = String(booking.requestId || requestId || "").trim();
    if (!resolvedId) {
      continue;
    }
    byRequestId.set(resolvedId, { ...booking, requestId: resolvedId });
  }

  const kvStore = env && env.BOOKINGS && typeof env.BOOKINGS.list === "function" && typeof env.BOOKINGS.get === "function"
    ? env.BOOKINGS
    : null;
  if (!kvStore) {
    return Array.from(byRequestId.values());
  }

  try {
    let cursor = undefined;
    while (true) {
      const listed = await kvStore.list({ cursor, limit: 1000 });
      const keys = listed && Array.isArray(listed.keys) ? listed.keys : [];
      for (const keyInfo of keys) {
        const keyName = typeof keyInfo?.name === "string" ? keyInfo.name : "";
        if (!keyName) {
          continue;
        }

        try {
          const raw = await kvStore.get(keyName);
          if (typeof raw !== "string" || !raw) {
            continue;
          }
          const parsed = JSON.parse(raw);
          const booking = toSafeBookingRecord(parsed);
          if (!booking) {
            continue;
          }
          const resolvedId = String(booking.requestId || keyName || "").trim();
          if (!resolvedId) {
            continue;
          }
          byRequestId.set(resolvedId, { ...booking, requestId: resolvedId });
        } catch (error) {
          console.error(`Skipping invalid booking record for key ${keyName}:`, error);
        }
      }

      if (!listed || listed.list_complete) {
        break;
      }
      cursor = listed.cursor;
      if (!cursor) {
        break;
      }
    }
  } catch (error) {
    console.error("Unable to list BOOKINGS KV for calendar feed:", error);
  }

  return Array.from(byRequestId.values());
}

function buildBookingRequestsIcs(bookings) {
  const nowStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LuxHouse//Booking Requests//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:LuxHouse Booking Requests",
    "X-WR-CALDESC:Requested bookings from the LuxHouse website.",
  ];

  for (const booking of bookings) {
    if (!shouldIncludeInRequestCalendar(booking)) {
      continue;
    }

    const checkinDate = new Date(`${booking.checkin}T00:00:00Z`);
    const checkoutDate = new Date(`${booking.checkout}T00:00:00Z`);
    if (Number.isNaN(checkinDate.getTime()) || Number.isNaN(checkoutDate.getTime()) || checkoutDate <= checkinDate) {
      continue;
    }

    const uid = `${escapeIcalText(String(booking.requestId || createRequestId()))}@luxhouse-worker`;
    const dtStart = formatUtcDateToIcalDate(checkinDate);
    const dtEnd = formatUtcDateToIcalDate(checkoutDate);
    const guestName = typeof booking.guestName === "string" && booking.guestName.trim() ? booking.guestName.trim() : "Guest";
    const status = String(booking.status || "requested").trim().toLowerCase();
    const summary = `REQUESTED - ${guestName}`;
    const descriptionParts = [
      `Request ID: ${booking.requestId || "N/A"}`,
      `Status: ${status || "requested"}`,
      `Check-in: ${booking.checkin || "N/A"}`,
      `Check-out: ${booking.checkout || "N/A"}`,
    ];
    if (booking.guestEmail) {
      descriptionParts.push(`Email: ${booking.guestEmail}`);
    }
    if (booking.guestPhone) {
      descriptionParts.push(`Phone: ${booking.guestPhone}`);
    }
    if (booking.notes) {
      descriptionParts.push(`Notes: ${booking.notes}`);
    }
    const description = descriptionParts.join("\n");

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${nowStamp}`);
    lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
    lines.push(`DTEND;VALUE=DATE:${dtEnd}`);
    lines.push(`SUMMARY:${escapeIcalText(summary)}`);
    lines.push(`DESCRIPTION:${escapeIcalText(description)}`);
    lines.push("STATUS:TENTATIVE");
    lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

async function handleBookingRequestsCalendar(env) {
  const bookings = await collectBookingsForCalendar(env);
  const ics = buildBookingRequestsIcs(bookings);
  return new Response(ics, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function handleAvailability(request, env) {
  const body = await parseJsonBody(request);
  const checkin = String(body.checkin || "").trim();
  const checkout = String(body.checkout || "").trim();
  const destination = String(body.destination || body.property || "").trim();
  if (isTemporarilyUnavailableDestination(destination)) {
    return jsonResponse({ available: false, error: PINE_COMING_SOON_MESSAGE });
  }

  if (!checkin || !checkout) {
    return jsonResponse({ available: false, error: "Missing dates" }, 400);
  }

  const stayRangeError = getStayRangeError(checkin, checkout);
  if (stayRangeError) {
    return jsonResponse({ available: false, error: stayRangeError }, 400);
  }

  const requestedStartMs = parseIsoDateToUtcMs(checkin);
  const requestedEndMs = parseIsoDateToUtcMs(checkout);
  if (!Number.isFinite(requestedStartMs) || !Number.isFinite(requestedEndMs) || requestedEndMs <= requestedStartMs) {
    return jsonResponse({ available: false, error: "Invalid date range" }, 400);
  }

  const blockedRanges = [];

  if (env.BLOCKED_START && env.BLOCKED_END) {
    const legacyStart = parseIsoDateToUtcMs(env.BLOCKED_START);
    const legacyEndInclusive = parseIsoDateToUtcMs(env.BLOCKED_END);
    if (Number.isFinite(legacyStart) && Number.isFinite(legacyEndInclusive)) {
      blockedRanges.push({
        startMs: legacyStart,
        endMs: legacyEndInclusive + 24 * 60 * 60 * 1000,
      });
    }
  }

  const icalUrls = collectIcalUrls(env, destination);
  for (const icalUrl of icalUrls) {
    try {
      const ranges = await getBusyRangesFromIcalUrl(icalUrl);
      blockedRanges.push(...ranges);
    } catch (error) {
      console.error(`iCal sync failed for ${icalUrl}:`, error);
    }
  }

  let available = true;
  for (const range of blockedRanges) {
    if (
      range &&
      Number.isFinite(range.startMs) &&
      Number.isFinite(range.endMs) &&
      rangesOverlapExclusive(requestedStartMs, requestedEndMs, range.startMs, range.endMs)
    ) {
      available = false;
      break;
    }
  }

  return jsonResponse({
    available,
    source: icalUrls.length > 0 ? "hospitable_ical" : "local_rules",
  });
}

async function handleCreateBooking(request, env) {
  const body = await parseJsonBody(request);
  const checkin = body.checkin;
  const checkout = body.checkout;
  const destination = String(body.destination || body.property || "").trim();
  if (isTemporarilyUnavailableDestination(destination)) {
    return jsonResponse({ error: PINE_COMING_SOON_MESSAGE }, 400);
  }

  if (!checkin || !checkout) {
    return jsonResponse({ error: "checkin and checkout are required" }, 400);
  }
  const stayRangeError = getStayRangeError(checkin, checkout);
  if (stayRangeError) {
    return jsonResponse({ error: stayRangeError }, 400);
  }

  const requestId = createRequestId();
  const booking = {
    requestId,
    checkin,
    checkout,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  await env.BOOKINGS.put(requestId, JSON.stringify(booking));
  return jsonResponse({ requestId });
}

async function handleGetBooking(request, env) {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId");

  if (!requestId) {
    return jsonResponse({ error: "requestId is required" }, 400);
  }

  const bookingRaw = await env.BOOKINGS.get(requestId);
  if (!bookingRaw) {
    return textResponse("Not found", 404);
  }

  return jsonResponse(JSON.parse(bookingRaw));
}

async function handleBookingStatus(request, env) {
  const pendingResponse = {
    ok: true,
    status: "pending_verification",
    message: STATUS_MESSAGES.pending_verification,
  };

  try {
    const url = new URL(request.url);
    const requestId = (url.searchParams?.get("requestId") || "").trim();

    if (!requestId) {
      return jsonResponse({
        ok: false,
        status: "missing_request_id",
        message:
          "We received your verification return, but could not locate your booking request.",
      });
    }

    const { existingMemory, existingKv } = await loadExistingBooking(env, requestId);
    let booking =
      Object.keys(existingMemory).length > 0 || Object.keys(existingKv).length > 0
        ? {
            ...existingMemory,
            ...existingKv,
          }
        : null;

    if (!booking) {
      return jsonResponse(pendingResponse);
    }

    booking = await refreshBookingIdentityStatusFromStripe(env, requestId, booking);

    const normalizedStatus = String(booking.status || "").trim().toLowerCase();
    if (normalizedStatus === "approved") {
      return jsonResponse({
        ok: true,
        status: "approved",
        message: STATUS_MESSAGES.approved,
        requestId,
        checkin: booking.checkin || null,
        checkout: booking.checkout || null,
      });
    }

    if (normalizedStatus === "verified") {
      return jsonResponse({
        ok: true,
        status: "verified",
        message: STATUS_MESSAGES.verified,
        requestId,
        checkin: booking.checkin || null,
        checkout: booking.checkout || null,
      });
    }

    if (normalizedStatus === "requires_input") {
      return jsonResponse({
        ok: true,
        status: "pending_verification",
        message: STATUS_MESSAGES.pending_verification,
        requestId,
        checkin: booking.checkin || null,
        checkout: booking.checkout || null,
      });
    }

    if (normalizedStatus === "rejected") {
      return jsonResponse({
        ok: true,
        status: normalizedStatus,
        message: STATUS_MESSAGES[normalizedStatus],
        requestId,
        checkin: booking.checkin || null,
        checkout: booking.checkout || null,
      });
    }

    return jsonResponse({
      ok: true,
      status: "pending_verification",
      message: STATUS_MESSAGES.pending_verification,
      requestId,
      checkin: booking.checkin || null,
      checkout: booking.checkout || null,
    });
  } catch (error) {
    console.error("Booking status handler error:", error);
    return jsonResponse(pendingResponse);
  }
}

function isBookingStatusPath(pathname) {
  return (
    pathname === "/booking-status" ||
    pathname === "/api/booking-status" ||
    pathname === "/status" ||
    pathname === "/verification-status"
  );
}

async function handleCreateVerificationSession(request, env) {
  const url = new URL(request.url);
  const body = await parseJsonBody(request);
  const stripeEndpoint = "/v1/identity/verification_sessions";
  const destinationRaw = String(
    body.destination || body.property || body.destinationLabel || ""
  ).trim();
  if (isTemporarilyUnavailableDestination(destinationRaw)) {
    return jsonResponse({ error: PINE_COMING_SOON_MESSAGE }, 400);
  }
  const bodyCheckin = typeof body.checkin === "string" ? body.checkin.trim() : "";
  const bodyCheckout = typeof body.checkout === "string" ? body.checkout.trim() : "";
  const bodyRequestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  const bodyReturnUrl = typeof body.returnUrl === "string" ? body.returnUrl.trim() : "";
  const bodyGuestEmail = typeof body.guestEmail === "string" ? body.guestEmail.trim() : "";
  const bodyGuestPhone = typeof body.guestPhone === "string" ? body.guestPhone.trim() : "";
  const bodyAddons = normalizeBookingAddons(body.addons);

  if (!bodyCheckin || !bodyCheckout) {
    return jsonResponse({ error: "checkin and checkout are required" }, 400);
  }
  const verificationStayError = getStayRangeError(bodyCheckin, bodyCheckout);
  if (verificationStayError) {
    return jsonResponse({ error: verificationStayError }, 400);
  }

  // Try to get existing requestId from URL
  let requestId = (url.searchParams.get("requestId") || "").trim();
  if (!requestId && bodyRequestId) {
    requestId = bodyRequestId;
  }

  // If missing, generate one
  if (!requestId) {
    requestId = "LUX-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
  }

  const keyDiagnostics = buildIdentityKeyDiagnostics(env);
  const flowIdFromBody =
    typeof body.verificationFlowId === "string" && body.verificationFlowId.trim()
      ? body.verificationFlowId.trim()
      : typeof body.verificationFlow === "string" && body.verificationFlow.trim()
        ? body.verificationFlow.trim()
        : "";
  const flowIdFromEnv =
    (typeof env.IDENTITY_VERIFICATION_FLOW_ID === "string" &&
      env.IDENTITY_VERIFICATION_FLOW_ID.trim()) ||
    "";
  const verificationFlowId = flowIdFromBody || flowIdFromEnv;
  const usingVerificationFlow = Boolean(verificationFlowId);
  const identityCreationMode = usingVerificationFlow ? "verification_flow" : "type_document";
  console.log({
    event: "stripe_identity_request_start",
    endpointReached: true,
    workerPath: url.pathname,
    workerMethod: request.method,
    stripeMethod: "POST",
    stripeEndpoint,
    requestId,
    hasStripeSecretKey: keyDiagnostics.hasStripeSecretKey,
    selectedKeySource: keyDiagnostics.selectedKeySource,
    selectedKeyKind: keyDiagnostics.selectedKeyKind,
    selectedMode: keyDiagnostics.selectedMode,
    fallbackKeyKind: keyDiagnostics.fallbackKeyKind,
    selectedKeyPreview: keyDiagnostics.selectedKeyPreview,
    identityCreationMode,
    hasVerificationFlowId: usingVerificationFlow,
    verificationFlowIdPreview: maskIdentifier(verificationFlowId),
  });

  const existingRaw = await env.BOOKINGS.get(requestId);
  if (!existingRaw) {
    const booking = {
      requestId,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    if (body.checkin) {
      booking.checkin = bodyCheckin;
    }
    if (body.checkout) {
      booking.checkout = bodyCheckout;
    }
    await env.BOOKINGS.put(requestId, JSON.stringify(booking));
  }

  const existingMemory = globalThis.BOOKINGS[requestId] && typeof globalThis.BOOKINGS[requestId] === "object"
    ? globalThis.BOOKINGS[requestId]
    : {};
  globalThis.BOOKINGS[requestId] = {
    ...existingMemory,
    requestId,
    status: "pending_verification",
    checkin: bodyCheckin || existingMemory.checkin || null,
    checkout: bodyCheckout || existingMemory.checkout || null,
    destination: normalizeAvailabilityDestination(destinationRaw) || destinationRaw || existingMemory.destination || null,
    guests: Number.isFinite(Number(body.guests)) ? Number(body.guests) : existingMemory.guests || null,
    nights: Number.isFinite(Number(body.nights)) ? Number(body.nights) : existingMemory.nights || null,
    nightlyRate: Number.isFinite(Number(body.nightlyRate)) ? Number(body.nightlyRate) : existingMemory.nightlyRate || null,
    addons: bodyAddons.length ? bodyAddons : normalizeBookingAddons(existingMemory.addons),
    addonsTotal: Number.isFinite(Number(body.addonsTotal)) ? Number(body.addonsTotal) : existingMemory.addonsTotal || null,
    total: Number.isFinite(Number(body.total)) ? Number(body.total) : existingMemory.total || null,
    updatedAt: Date.now(),
  };

  const params = new URLSearchParams();
  if (usingVerificationFlow) {
    params.set("verification_flow", verificationFlowId);
  } else {
    params.set("type", "document");
  }
  params.set("client_reference_id", requestId);
  params.set("metadata[requestId]", requestId);
  params.set("metadata[checkin]", bodyCheckin);
  params.set("metadata[checkout]", bodyCheckout);
  if (destinationRaw) {
    params.set("metadata[destination]", destinationRaw);
  }
  if (bodyGuestEmail) {
    params.set("provided_details[email]", bodyGuestEmail);
  }
  if (bodyGuestPhone) {
    params.set("provided_details[phone]", bodyGuestPhone);
  }

  const configuredReturnUrl =
    typeof env.IDENTITY_RETURN_URL === "string" ? env.IDENTITY_RETURN_URL.trim() : "";
  const fallbackReturnUrl = `${url.origin}/booking-status.html`;
  const returnUrl = new URL(bodyReturnUrl || configuredReturnUrl || fallbackReturnUrl, request.url);
  if (!returnUrl.searchParams.get("requestId")) {
    returnUrl.searchParams.set("requestId", requestId);
  }
  params.set("return_url", returnUrl.toString());

  const stripeIdentityKey =
    getStripeSecretKey(env);
  if (!stripeIdentityKey) {
    console.error({
      event: "stripe_identity_request_failure",
      reason: "missing_api_key",
      requestId,
      keyDiagnostics,
    });
    return jsonResponse(
      {
        ok: false,
        error: "Unable to start identity verification at this time.",
        code: "identity_missing_api_key",
        requestId,
        debug: {
          endpointReached: true,
          keyDiagnostics,
        },
      },
      500
    );
  }

  if (keyDiagnostics.selectedKeyKind.startsWith("publishable_")) {
    console.error({
      event: "stripe_identity_request_failure",
      reason: "publishable_key_used_server_side",
      requestId,
      keyDiagnostics,
    });
    return jsonResponse(
      {
        ok: false,
        error: "Unable to start identity verification at this time.",
        code: "identity_invalid_key_type",
        requestId,
        debug: {
          endpointReached: true,
          keyDiagnostics,
        },
      },
      500
    );
  }

  let stripeRes = null;
  let stripeData = {};
  const stripeIdentityEndpointUrl = "https://api.stripe.com/v1/identity/verification_sessions";
  const payloadKeys = Array.from(params.keys());
  console.log({
    event: "stripe_identity_request_payload",
    requestId,
    stripeEndpoint,
    stripeEndpointUrl: stripeIdentityEndpointUrl,
    identityCreationMode,
    hasVerificationFlowId: usingVerificationFlow,
    verificationFlowIdPreview: maskIdentifier(verificationFlowId),
    hasReturnUrl: Boolean(params.get("return_url")),
    hasClientReferenceId: Boolean(params.get("client_reference_id")),
    hasProvidedEmail: Boolean(params.get("provided_details[email]")),
    hasProvidedPhone: Boolean(params.get("provided_details[phone]")),
    metadataKeys: ["requestId", "checkin", "checkout", destinationRaw ? "destination" : ""].filter(Boolean),
    payloadKeys,
    requestedType: params.get("type") || null,
  });
  try {
    stripeRes = await fetch(stripeIdentityEndpointUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeIdentityKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    stripeData = await parseStripeResponseBody(stripeRes);
    const hasStripeErrorObject = Boolean(stripeData && stripeData.error);
    console.log({
      event: "stripe_identity_response_received",
      requestId,
      stripeEndpoint,
      stripeStatus: stripeRes.status,
      responseObjectType:
        stripeData && typeof stripeData.object === "string" ? stripeData.object : null,
      hasErrorObject: hasStripeErrorObject,
      hasUrl: Boolean(stripeData && stripeData.url),
      responsePayload: hasStripeErrorObject
        ? stripeData
        : {
            id: stripeData && typeof stripeData.id === "string" ? stripeData.id : null,
            object: stripeData && typeof stripeData.object === "string" ? stripeData.object : null,
            status: stripeData && typeof stripeData.status === "string" ? stripeData.status : null,
            livemode: stripeData && typeof stripeData.livemode === "boolean" ? stripeData.livemode : null,
          },
    });
  } catch (error) {
    console.error({
      event: "stripe_identity_request_failure",
      reason: "network_or_runtime_error",
      requestId,
      keyDiagnostics,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      {
        ok: false,
        error: "Unable to start identity verification at this time.",
        code: "identity_network_error",
        requestId,
        debug: {
          endpointReached: true,
          keyDiagnostics,
        },
      },
      502
    );
  }

  const stripeRequestId =
    stripeRes.headers.get("request-id") ||
    stripeRes.headers.get("Request-Id") ||
    null;
  const stripeErrorObj =
    stripeData && stripeData.error && typeof stripeData.error === "object"
      ? stripeData.error
      : null;

  if (!stripeRes.ok) {
    const looksLikeFlowIsRequired =
      identityCreationMode === "type_document" &&
      stripeRes.status === 403 &&
      stripeErrorObj &&
      typeof stripeErrorObj.message === "string" &&
      stripeErrorObj.message.includes("unable to perform this action");

    console.error({
      event: "stripe_identity_request_failure",
      reason: "stripe_api_error",
      requestId,
      stripeStatus: stripeRes.status,
      stripeRequestId,
      stripeErrorType: stripeErrorObj && stripeErrorObj.type ? stripeErrorObj.type : null,
      stripeErrorCode: stripeErrorObj && stripeErrorObj.code ? stripeErrorObj.code : null,
      stripeErrorMessage: stripeErrorObj && stripeErrorObj.message ? stripeErrorObj.message : null,
      keyDiagnostics,
      stripeErrorPayload: stripeData,
      identityCreationMode,
      hasVerificationFlowId: usingVerificationFlow,
      verificationFlowIdPreview: maskIdentifier(verificationFlowId),
      flowMayBeRequired: looksLikeFlowIsRequired,
    });

    return jsonResponse(
      {
        ok: false,
        error: looksLikeFlowIsRequired
          ? "Stripe Identity rejected direct document session creation for this account. Configure a Dashboard Verification Flow and set IDENTITY_VERIFICATION_FLOW_ID."
          : "Unable to start identity verification at this time.",
        code: "identity_session_create_failed",
        requestId,
        debug: {
          endpointReached: true,
          stripeStatus: stripeRes.status,
          stripeRequestId,
          stripeError: {
            type: stripeErrorObj && stripeErrorObj.type ? stripeErrorObj.type : null,
            code: stripeErrorObj && stripeErrorObj.code ? stripeErrorObj.code : null,
            message: stripeErrorObj && stripeErrorObj.message ? stripeErrorObj.message : null,
            param: stripeErrorObj && stripeErrorObj.param ? stripeErrorObj.param : null,
            doc_url: stripeErrorObj && stripeErrorObj.doc_url ? stripeErrorObj.doc_url : null,
          },
          keyDiagnostics,
          identityCreationMode,
          hasVerificationFlowId: usingVerificationFlow,
          verificationFlowIdPreview: maskIdentifier(verificationFlowId),
          flowMayBeRequired: looksLikeFlowIsRequired,
          stripeErrorPayload: stripeData,
        },
      },
      stripeRes.status >= 400 && stripeRes.status < 600 ? stripeRes.status : 500
    );
  }

  console.log({
    event: "stripe_identity_request_success",
    requestId,
    stripeStatus: stripeRes.status,
    stripeRequestId,
    hasVerificationUrl: Boolean(stripeData && stripeData.url),
    keyDiagnostics,
  });

  const stripeVerificationSessionId =
    stripeData && typeof stripeData.id === "string" ? stripeData.id.trim() : "";
  const stripeIdentityStatus =
    stripeData && typeof stripeData.status === "string"
      ? stripeData.status.trim()
      : "pending_verification";
  await persistBookingFromWebhook(env, requestId, {
    status: "pending_verification",
    identityStatus: stripeIdentityStatus || "pending_verification",
    stripeVerificationSessionId: stripeVerificationSessionId || null,
    stripeVerificationSessionCreatedAt: new Date().toISOString(),
    checkin: bodyCheckin || null,
    checkout: bodyCheckout || null,
    destination: normalizeAvailabilityDestination(destinationRaw) || destinationRaw || null,
    guests: Number.isFinite(Number(body.guests)) ? Number(body.guests) : null,
    nights: Number.isFinite(Number(body.nights)) ? Number(body.nights) : null,
    nightlyRate: Number.isFinite(Number(body.nightlyRate)) ? Number(body.nightlyRate) : null,
    addons: bodyAddons,
    addonsTotal: Number.isFinite(Number(body.addonsTotal)) ? Number(body.addonsTotal) : null,
    total: Number.isFinite(Number(body.total)) ? Number(body.total) : null,
  });

  return jsonResponse({
    ok: true,
    url: stripeData.url,
    requestId: requestId,
  });
}

async function handleSubmitBookingRequest(request, env) {
  const body = await parseJsonBody(request);
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  if (!requestId) {
    return jsonResponse({ error: "requestId is required" }, 400);
  }

  const destinationRaw = String(
    body.destination || body.property || body.destinationLabel || ""
  ).trim();
  if (isTemporarilyUnavailableDestination(destinationRaw)) {
    return jsonResponse({ error: PINE_COMING_SOON_MESSAGE }, 400);
  }

  const guestName = typeof body.guestName === "string" ? body.guestName.trim() : "";
  const guestEmail = typeof body.guestEmail === "string" ? body.guestEmail.trim() : "";
  const guestPhone = typeof body.guestPhone === "string" ? body.guestPhone.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const checkin = typeof body.checkin === "string" ? body.checkin.trim() : "";
  const checkout = typeof body.checkout === "string" ? body.checkout.trim() : "";

  if (!guestName || !guestEmail || !guestPhone) {
    return jsonResponse({ error: "Guest name, email, and phone are required." }, 400);
  }
  if (!checkin || !checkout) {
    return jsonResponse({ error: "checkin and checkout are required" }, 400);
  }
  const requestStayError = getStayRangeError(checkin, checkout);
  if (requestStayError) {
    return jsonResponse({ error: requestStayError }, 400);
  }

  const { existingMemory, existingKv } = await loadExistingBooking(env, requestId);
  let booking = {
    ...existingKv,
    ...existingMemory,
  };
  if (!Object.keys(booking).length) {
    return jsonResponse(
      {
        error: "Booking request was not found. Please restart the verified booking flow.",
        code: "booking_request_not_found",
      },
      404
    );
  }

  booking = await refreshBookingIdentityStatusFromStripe(env, requestId, booking);
  const identityStatus = String(booking.status || "").trim().toLowerCase();
  if (identityStatus !== "verified" && identityStatus !== "approved") {
    return jsonResponse(
      {
        error: "Identity verification must be confirmed before submitting this booking request.",
        code: "booking_request_identity_required",
        status: identityStatus || "pending_verification",
      },
      403
    );
  }

  const addons = normalizeBookingAddons(
    Array.isArray(body.addons) || typeof body.addons === "string" ? body.addons : booking.addons
  );
  const nights =
    toFiniteNumber(body.nights, 0) ||
    toFiniteNumber(booking.nights, 0) ||
    toFiniteNumber(calculateStayNights(checkin, checkout), 0);
  const nightlyRate = toFiniteNumber(body.nightlyRate, toFiniteNumber(booking.nightlyRate, 0));
  const addonsTotal =
    toFiniteNumber(body.addonsTotal, NaN) ||
    addons.reduce((sum, addon) => sum + toFiniteNumber(addon.price, 0), 0);
  const total =
    toFiniteNumber(body.total, 0) ||
    toFiniteNumber(booking.total, 0) ||
    (nights > 0 && nightlyRate > 0 ? nights * nightlyRate : 0) + addonsTotal;
  const destinationLabel =
    typeof body.destinationLabel === "string" && body.destinationLabel.trim()
      ? body.destinationLabel.trim()
      : booking.destinationLabel || booking.destination || destinationRaw || "LuxHouse Booking";

  const now = new Date().toISOString();
  const updatedBooking = await persistBookingFromWebhook(env, requestId, {
    status: identityStatus === "approved" ? "approved" : "verified",
    identityStatus: booking.identityStatus || identityStatus,
    bookingRequestStatus: "requested",
    bookingRequestedAt: now,
    guestName,
    guestEmail,
    guestPhone,
    notes,
    destination: normalizeAvailabilityDestination(destinationRaw) || booking.destination || destinationRaw || null,
    destinationLabel,
    checkin,
    checkout,
    guests: Number.isFinite(Number(body.guests)) ? Number(body.guests) : booking.guests || null,
    nights,
    nightlyRate,
    addons,
    addonsTotal,
    total,
  });

  const artifacts = await collectIdentityArtifacts(env, updatedBooking || booking);
  if (artifacts.reportId && !updatedBooking?.stripeVerificationReportId) {
    await persistBookingFromWebhook(env, requestId, {
      stripeVerificationReportId: artifacts.reportId,
    });
  }

  const email = buildBookingRequestEmail(updatedBooking || booking, artifacts);
  const emailResult = await sendBookingRequestEmail(env, email, guestEmail);
  if (!emailResult.ok) {
    console.error({
      event: "booking_request_email_failed",
      requestId,
      emailStatus: emailResult.status,
      emailCode: emailResult.code || null,
      emailMessage: emailResult.message || null,
    });
    return jsonResponse(
      {
        error: emailResult.message || "Booking request email could not be sent.",
        code: emailResult.code || "booking_email_failed",
        requestId,
        bookingStored: true,
      },
      emailResult.status >= 400 && emailResult.status < 600 ? emailResult.status : 500
    );
  }

  await persistBookingFromWebhook(env, requestId, {
    bookingRequestEmailSentAt: new Date().toISOString(),
    bookingRequestEmailProviderId:
      emailResult.data && typeof emailResult.data.id === "string" ? emailResult.data.id : null,
  });

  return jsonResponse({
    ok: true,
    requestId,
    emailSent: true,
  });
}

async function handleCreatePaymentSession(request, env) {
  const body = await parseJsonBody(request);
  const requestId =
    (typeof body.requestId === "string" && body.requestId.trim()) ||
    createRequestId();
  const destinationRaw = String(
    body.destination || body.property || body.destinationLabel || ""
  ).trim();
  if (isTemporarilyUnavailableDestination(destinationRaw)) {
    return jsonResponse({ error: PINE_COMING_SOON_MESSAGE }, 400);
  }

  const guestName = typeof body.guestName === "string" ? body.guestName.trim() : "";
  const guestEmail = typeof body.guestEmail === "string" ? body.guestEmail.trim() : "";
  const guestPhone = typeof body.guestPhone === "string" ? body.guestPhone.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const destination = typeof body.destinationLabel === "string" ? body.destinationLabel.trim() : "LuxHouse Booking";
  const checkin = typeof body.checkin === "string" ? body.checkin.trim() : "";
  const checkout = typeof body.checkout === "string" ? body.checkout.trim() : "";
  if (!checkin || !checkout) {
    return jsonResponse({ error: "checkin and checkout are required" }, 400);
  }
  const paymentStayError = getStayRangeError(checkin, checkout);
  if (paymentStayError) {
    return jsonResponse({ error: paymentStayError }, 400);
  }
  const totalNumber = Number(body.total);
  const totalAmountCents = Number.isFinite(totalNumber) && totalNumber > 0
    ? Math.round(totalNumber * 100)
    : 10000;

  const { existingMemory, existingKv } = await loadExistingBooking(env, requestId);
  const memoryBooking = {
    ...existingKv,
    ...existingMemory,
  };
  const existingStatus = String(memoryBooking.status || "").trim().toLowerCase();
  const canRequestPayment = existingStatus === "verified" || existingStatus === "approved";
  if (!canRequestPayment) {
    return jsonResponse(
      {
        error: "Identity verification is required before payment.",
        code: "payment_verification_required",
      },
      403
    );
  }

  globalThis.BOOKINGS[requestId] = {
    ...memoryBooking,
    requestId,
    status: existingStatus === "approved" ? "approved" : "verified",
    bookingRequestStatus: "requested",
    bookingRequestedAt: new Date().toISOString(),
    guestName,
    guestEmail,
    guestPhone,
    notes,
    checkin: checkin || memoryBooking.checkin || null,
    checkout: checkout || memoryBooking.checkout || null,
    total: Number.isFinite(totalNumber) ? totalNumber : memoryBooking.total || null,
    updatedAt: Date.now(),
  };

  const kvStore = env && env.BOOKINGS && typeof env.BOOKINGS.put === "function" ? env.BOOKINGS : null;
  if (kvStore) {
    try {
      await kvStore.put(requestId, JSON.stringify(globalThis.BOOKINGS[requestId]));
    } catch (error) {
      console.error("Payment session KV write failed:", error);
    }
  }

  const origin = new URL(request.url).origin;
  const successUrl = env.PAYMENT_SUCCESS_URL || `${origin}/booking.html?payment=success&requestId=${encodeURIComponent(requestId)}`;
  const cancelUrl = env.PAYMENT_CANCEL_URL || `${origin}/booking.html?payment=cancelled&requestId=${encodeURIComponent(requestId)}`;

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(totalAmountCents));
  params.set("line_items[0][price_data][product_data][name]", `${destination} Booking Request`);
  params.set("metadata[requestId]", requestId);
  if (guestName) {
    params.set("metadata[guestName]", guestName);
  }
  if (guestPhone) {
    params.set("metadata[guestPhone]", guestPhone);
  }
  if (checkin) {
    params.set("metadata[checkin]", checkin);
  }
  if (checkout) {
    params.set("metadata[checkout]", checkout);
  }
  if (notes) {
    params.set("metadata[notes]", notes);
  }
  if (guestEmail) {
    params.set("customer_email", guestEmail);
  }
  params.set("client_reference_id", requestId);

  const stripePaymentKey = getStripeSecretKey(env);
  if (!stripePaymentKey) {
    return jsonResponse(
      {
        error: "Unable to start checkout at this time.",
        code: "payment_missing_api_key",
      },
      500
    );
  }

  const paymentKeyKind = detectStripeKeyKind(stripePaymentKey);
  if (paymentKeyKind.startsWith("publishable_")) {
    return jsonResponse(
      {
        error: "Unable to start checkout at this time.",
        code: "payment_invalid_key_type",
      },
      500
    );
  }

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripePaymentKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const stripeData = await parseStripeResponseBody(stripeRes);
  if (!stripeRes.ok) {
    return jsonResponse(
      { error: extractStripeErrorMessage(stripeData, "Stripe Checkout error") },
      500
    );
  }

  return jsonResponse({
    url: stripeData.url,
    requestId,
    sessionId: stripeData.id || null,
  });
}

async function handleWebhook(request, env) {
  const webhookSecret =
    typeof env.STRIPE_WEBHOOK_SECRET === "string" ? env.STRIPE_WEBHOOK_SECRET.trim() : "";
  if (!webhookSecret) {
    console.error("Missing STRIPE_WEBHOOK_SECRET");
    return jsonResponse(
      {
        received: false,
        error: "Webhook endpoint is not configured.",
      },
      500
    );
  }

  const signatureHeader =
    request.headers.get("Stripe-Signature") || request.headers.get("stripe-signature") || "";
  const rawBody = await request.text();
  let signatureResult = { ok: false, reason: "unknown" };
  try {
    signatureResult = await verifyStripeWebhookSignature({
      rawBody,
      signatureHeader,
      endpointSecret: webhookSecret,
      toleranceSeconds: 300,
    });
  } catch (error) {
    console.error("Webhook signature verification threw:", error);
    signatureResult = {
      ok: false,
      reason: "verification_runtime_error",
    };
  }

  if (!signatureResult.ok) {
    console.error("Rejected webhook: invalid Stripe signature", signatureResult.reason);
    return jsonResponse(
      {
        received: false,
        error: "Invalid Stripe webhook signature.",
      },
      400
    );
  }

  let event = {};
  try {
    event = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    console.error("Webhook JSON parse error:", error);
    return jsonResponse(
      {
        received: false,
        error: "Invalid webhook JSON payload.",
      },
      400
    );
  }

  const eventType = event && typeof event.type === "string" ? event.type : "";
  const eventDataObject = event && event.data ? event.data.object : null;
  const requestId = extractWebhookRequestId(eventDataObject);
  const dedupKeys = buildStripeEventDedupKeys(event, eventType, eventDataObject);
  const eventMode = typeof event.livemode === "boolean" ? (event.livemode ? "live" : "test") : "unknown";
  const workerMode = detectStripeModeFromEnv(env);
  if (eventMode !== "unknown" && workerMode !== "unknown" && eventMode !== workerMode) {
    console.error({
      event: "stripe_webhook_rejected_mode_mismatch",
      requestId,
      eventMode,
      workerMode,
      eventType,
    });
    return jsonResponse(
      {
        received: false,
        error: "Webhook mode mismatch.",
      },
      400
    );
  }

  console.log({
    event: "stripe_webhook_received",
    eventType,
    requestId,
    eventId: event && typeof event.id === "string" ? event.id : null,
    eventMode,
    workerMode,
  });

  let dedupPatch = {};
  if (requestId && dedupKeys.length > 0) {
    const { existingMemory, existingKv } = await loadExistingBooking(env, requestId);
    const existing = {
      ...existingKv,
      ...existingMemory,
    };
    const processedKeys = normalizeProcessedStripeEventKeys(existing.processedStripeEventKeys);
    const isDuplicate = dedupKeys.some((key) => processedKeys.includes(key));
    if (isDuplicate) {
      return jsonResponse({
        received: true,
        duplicate: true,
        event: eventType || null,
        requestId,
      });
    }
    dedupPatch = {
      processedStripeEventKeys: normalizeProcessedStripeEventKeys([
        ...processedKeys,
        ...dedupKeys,
      ]),
    };
  }

  if (requestId && eventType === "identity.verification_session.verified") {
    await persistBookingFromWebhook(env, requestId, {
      status: "verified",
      identityStatus: "verified",
      identityVerifiedAt: new Date().toISOString(),
      stripeVerificationSessionId:
        eventDataObject && typeof eventDataObject.id === "string" ? eventDataObject.id : null,
      stripeVerificationReportId: getVerificationReportIdFromStripeData(eventDataObject),
      ...dedupPatch,
    });
  }

  if (
    requestId &&
    (eventType === "identity.verification_session.requires_input" ||
      eventType === "identity.verification_session.canceled")
  ) {
    const { existingMemory, existingKv } = await loadExistingBooking(env, requestId);
    const existing = {
      ...existingKv,
      ...existingMemory,
    };
    const existingStatus = String(existing.status || "").trim().toLowerCase();
    const existingPaymentStatus = String(existing.paymentStatus || "").trim().toLowerCase();
    const shouldPreserveApprovedState =
      existingStatus === "approved" || existingPaymentStatus === "paid";

    if (!shouldPreserveApprovedState) {
      const hasVerificationError =
        eventDataObject &&
        typeof eventDataObject === "object" &&
        Boolean(eventDataObject.last_error);
      const mappedStatus =
        eventType === "identity.verification_session.canceled"
          ? "rejected"
          : "pending_verification";
      const patch = {
        status: mappedStatus,
        identityStatus: mappedStatus,
        identityUpdatedAt: new Date().toISOString(),
        stripeVerificationSessionId:
          eventDataObject && typeof eventDataObject.id === "string" ? eventDataObject.id : null,
        stripeVerificationReportId: getVerificationReportIdFromStripeData(eventDataObject),
        ...dedupPatch,
      };
      if (hasVerificationError) {
        patch.identityLastError = eventDataObject.last_error;
      }
      await persistBookingFromWebhook(env, requestId, {
        ...patch,
      });
    }
  }

  if (
    requestId &&
    (eventType === "checkout.session.completed" ||
      eventType === "checkout.session.async_payment_succeeded")
  ) {
    const checkoutPaymentStatus =
      eventDataObject && typeof eventDataObject.payment_status === "string"
        ? eventDataObject.payment_status.trim().toLowerCase()
        : "";
    const paidState =
      checkoutPaymentStatus === "paid" || checkoutPaymentStatus === "no_payment_required";
    await persistBookingFromWebhook(env, requestId, {
      status: paidState ? "approved" : "verified",
      bookingRequestStatus: paidState ? "approved" : "requested",
      paymentStatus: paidState ? "paid" : checkoutPaymentStatus || "unpaid",
      paymentCompletedAt: paidState ? new Date().toISOString() : null,
      stripeCheckoutSessionId:
        eventDataObject && typeof eventDataObject.id === "string" ? eventDataObject.id : null,
      stripePaymentIntentId:
        eventDataObject && typeof eventDataObject.payment_intent === "string"
          ? eventDataObject.payment_intent
          : null,
      ...dedupPatch,
    });
  }

  if (
    requestId &&
    (eventType === "checkout.session.expired" ||
      eventType === "checkout.session.async_payment_failed")
  ) {
    const { existingMemory, existingKv } = await loadExistingBooking(env, requestId);
    const existing = {
      ...existingKv,
      ...existingMemory,
    };
    const existingPaymentStatus = String(existing.paymentStatus || "").trim().toLowerCase();
    const alreadyPaid = existingPaymentStatus === "paid";
    if (!alreadyPaid) {
      const expiredOrFailedStatus =
        eventType === "checkout.session.async_payment_failed" ? "failed" : "expired";
      const bookingRequestStatus =
        eventType === "checkout.session.async_payment_failed"
          ? "payment_failed"
          : "payment_expired";
      await persistBookingFromWebhook(env, requestId, {
        bookingRequestStatus,
        paymentStatus: expiredOrFailedStatus,
        paymentExpiredAt: new Date().toISOString(),
        stripeCheckoutSessionId:
          eventDataObject && typeof eventDataObject.id === "string" ? eventDataObject.id : null,
        ...dedupPatch,
      });
    }
  }

  return jsonResponse({
    received: true,
    event: eventType || null,
    requestId: requestId || null,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if ((pathname === "/webhook" || pathname === "/webhook/") && method === "POST") {
      return handleWebhook(request, env);
    }

    if (pathname.includes("availability") && method === "POST") {
      return handleAvailability(request, env);
    }

    if (pathname.includes("create-booking") && method === "POST") {
      return handleCreateBooking(request, env);
    }

    if (pathname === "/create-verification-session" && method === "POST") {
      return handleCreateVerificationSession(request, env);
    }

    if (pathname === "/submit-booking-request" && method === "POST") {
      return handleSubmitBookingRequest(request, env);
    }

    if (pathname === "/create-payment-session" && method === "POST") {
      return handleCreatePaymentSession(request, env);
    }

    if (pathname.includes("verify") && method === "POST") {
      return handleCreateVerificationSession(request, env);
    }

    if (pathname.includes("get-booking") && method === "GET") {
      return handleGetBooking(request, env);
    }

    if (pathname === "/booking-requests.ics" && method === "GET") {
      return handleBookingRequestsCalendar(env);
    }

    if (method === "GET" && isBookingStatusPath(pathname)) {
      return handleBookingStatus(request, env);
    }

    return textResponse("Not found", 404);
  },
};
