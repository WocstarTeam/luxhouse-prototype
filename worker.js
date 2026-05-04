globalThis.BOOKINGS = globalThis.BOOKINGS || {};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const STATUS_MESSAGES = {
  pending_verification:
    "Thank you for submitting your documents. Our team is reviewing your verification and will get back to you promptly.",
  verified:
    "Your identity verification was successful. You may now continue with your booking.",
  requires_input:
    "We could not complete verification. Please try again.",
  rejected:
    "Verification could not be completed. Please contact support.",
  approved:
    "Your request has been approved. Our team will contact you with the next steps.",
  unknown:
    "Thank you. Your booking request is being reviewed by our team.",
};

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

  if (!checkin || !checkout) {
    return jsonResponse({ available: false, error: "Missing dates" }, 400);
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

  if (!checkin || !checkout) {
    return jsonResponse({ error: "checkin and checkout are required" }, 400);
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

    let booking = null;
    if (globalThis.BOOKINGS && typeof globalThis.BOOKINGS[requestId] === "object") {
      booking = globalThis.BOOKINGS[requestId];
    }

    if (!booking) {
      const kvStore = env && env.BOOKINGS && typeof env.BOOKINGS.get === "function" ? env.BOOKINGS : null;
      if (kvStore) {
        try {
          const bookingRaw = await kvStore.get(requestId);
          if (typeof bookingRaw === "string" && bookingRaw) {
            const parsed = JSON.parse(bookingRaw);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              booking = parsed;
            }
          }
        } catch (error) {
          console.error("Booking status KV read failed:", error);
        }
      }
    }

    if (!booking) {
      return jsonResponse(pendingResponse);
    }

    const normalizedStatus = String(booking.status || "").trim().toLowerCase();
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

    if (normalizedStatus === "requires_input" || normalizedStatus === "rejected") {
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
  const bodyRequestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  const bodyReturnUrl = typeof body.returnUrl === "string" ? body.returnUrl.trim() : "";

  // Try to get existing requestId from URL
  let requestId = (url.searchParams.get("requestId") || "").trim();
  if (!requestId && bodyRequestId) {
    requestId = bodyRequestId;
  }

  // If missing, generate one
  if (!requestId) {
    requestId = "LUX-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
  }

  const existingRaw = await env.BOOKINGS.get(requestId);
  if (!existingRaw) {
    const booking = {
      requestId,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    if (body.checkin) {
      booking.checkin = body.checkin;
    }
    if (body.checkout) {
      booking.checkout = body.checkout;
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
    checkin: body.checkin || existingMemory.checkin || null,
    checkout: body.checkout || existingMemory.checkout || null,
    updatedAt: Date.now(),
  };

  const params = new URLSearchParams();
  params.set("type", "document");
  params.set("metadata[requestId]", requestId);

  const configuredReturnUrl =
    typeof env.IDENTITY_RETURN_URL === "string" ? env.IDENTITY_RETURN_URL.trim() : "";
  const fallbackReturnUrl = `${url.origin}/booking-status.html`;
  const returnUrl = new URL(bodyReturnUrl || configuredReturnUrl || fallbackReturnUrl, request.url);
  if (!returnUrl.searchParams.get("requestId")) {
    returnUrl.searchParams.set("requestId", requestId);
  }
  params.set("return_url", returnUrl.toString());

  const stripeRes = await fetch("https://api.stripe.com/v1/identity/verification_sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const stripeData = await stripeRes.json();
  if (!stripeRes.ok) {
    return jsonResponse({ error: stripeData.error?.message || "Stripe error" }, 500);
  }

  return jsonResponse({
    url: stripeData.url,
    requestId: requestId,
  });
}

async function handleCreatePaymentSession(request, env) {
  const body = await parseJsonBody(request);
  const requestId =
    (typeof body.requestId === "string" && body.requestId.trim()) ||
    createRequestId();

  const guestName = typeof body.guestName === "string" ? body.guestName.trim() : "";
  const guestEmail = typeof body.guestEmail === "string" ? body.guestEmail.trim() : "";
  const guestPhone = typeof body.guestPhone === "string" ? body.guestPhone.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const destination = typeof body.destinationLabel === "string" ? body.destinationLabel.trim() : "LuxHouse Booking";
  const checkin = typeof body.checkin === "string" ? body.checkin.trim() : "";
  const checkout = typeof body.checkout === "string" ? body.checkout.trim() : "";
  const totalNumber = Number(body.total);
  const totalAmountCents = Number.isFinite(totalNumber) && totalNumber > 0
    ? Math.round(totalNumber * 100)
    : 10000;

  const memoryBooking = globalThis.BOOKINGS[requestId] && typeof globalThis.BOOKINGS[requestId] === "object"
    ? globalThis.BOOKINGS[requestId]
    : {};

  globalThis.BOOKINGS[requestId] = {
    ...memoryBooking,
    requestId,
    status: memoryBooking.status || "verified",
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

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const stripeData = await stripeRes.json();
  if (!stripeRes.ok) {
    return jsonResponse({ error: stripeData.error?.message || "Stripe error" }, 500);
  }

  return jsonResponse({
    url: stripeData.url,
    requestId,
    sessionId: stripeData.id || null,
  });
}

async function handleWebhook(request, env) {
  let event = {};
  try {
    event = await request.json();
  } catch (error) {
    console.error("Webhook JSON parse error:", error);
    event = {};
  }

  const eventType = event && typeof event.type === "string" ? event.type : "";
  const session = event && event.data ? event.data.object : null;
  const requestId = session?.metadata?.requestId;

  console.log(eventType, requestId);

  if (event.type === "identity.verification_session.verified" && requestId) {
    const memoryBooking =
      globalThis.BOOKINGS[requestId] && typeof globalThis.BOOKINGS[requestId] === "object"
        ? globalThis.BOOKINGS[requestId]
        : {};
    globalThis.BOOKINGS[requestId] = {
      ...memoryBooking,
      status: "verified",
      updatedAt: Date.now()
    };

    console.log("Booking verified:", requestId);
  }

  if (eventType === "identity.verification_session.requires_input" && requestId) {
    const memoryBooking =
      globalThis.BOOKINGS[requestId] && typeof globalThis.BOOKINGS[requestId] === "object"
        ? globalThis.BOOKINGS[requestId]
        : {};
    globalThis.BOOKINGS[requestId] = {
      ...memoryBooking,
      status: "requires_input",
      updatedAt: Date.now(),
    };
  }

  if (eventType === "identity.verification_session.canceled" && requestId) {
    const memoryBooking =
      globalThis.BOOKINGS[requestId] && typeof globalThis.BOOKINGS[requestId] === "object"
        ? globalThis.BOOKINGS[requestId]
        : {};
    globalThis.BOOKINGS[requestId] = {
      ...memoryBooking,
      status: "rejected",
      updatedAt: Date.now(),
    };
  }

  if (requestId) {
    const kvStore = env && env.BOOKINGS && typeof env.BOOKINGS.put === "function" ? env.BOOKINGS : null;
    if (kvStore) {
      try {
        const existingRaw = await kvStore.get(requestId);
        let existingBooking = {};
        if (typeof existingRaw === "string" && existingRaw) {
          const parsed = JSON.parse(existingRaw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            existingBooking = parsed;
          }
        }

        const memoryBooking =
          globalThis.BOOKINGS[requestId] && typeof globalThis.BOOKINGS[requestId] === "object"
            ? globalThis.BOOKINGS[requestId]
            : {};

        await kvStore.put(
          requestId,
          JSON.stringify({
            ...existingBooking,
            ...memoryBooking,
            requestId,
          })
        );
      } catch (error) {
        console.error("Webhook KV sync failed:", error);
      }
    }
  }

  return new Response(
    JSON.stringify({
      received: true,
      event: event.type,
      requestId: requestId || null,
    }),
    {
      headers: { "Content-Type": "application/json" },
    }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (pathname === "/webhook" && method === "POST") {
      return handleWebhook(request, env);
    }

    if (pathname.includes("webhook") && method === "POST") {
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
