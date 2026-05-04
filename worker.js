const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const STATUS_MESSAGES = {
  pending_verification:
    "Thank you for submitting your documents. Our team is reviewing your verification and will get back to you promptly.",
  verified:
    "Your identity verification was successful. You may continue with your booking request.",
  requires_input:
    "We could not complete the verification. Please try again or contact our team.",
  rejected:
    "We could not approve the verification at this stage. Please contact our team for support.",
  approved:
    "Your request has been approved. Our team will contact you with the next steps.",
  unknown:
    "Thank you. Your booking request is being reviewed by our team.",
};

let BOOKINGS = {};

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

function datesOverlap(startA, endA, startB, endB) {
  const aStart = new Date(startA);
  const aEnd = new Date(endA);
  const bStart = new Date(startB);
  const bEnd = new Date(endB);
  return aStart <= bEnd && bStart <= aEnd;
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

async function handleAvailability(request, env) {
  const body = await parseJsonBody(request);
  const checkin = body.checkin;
  const checkout = body.checkout;

  if (!checkin || !checkout) {
    return jsonResponse({ available: false, error: "Missing dates" }, 400);
  }

  let available = true;
  if (env.BLOCKED_START && env.BLOCKED_END) {
    available = !datesOverlap(checkin, checkout, env.BLOCKED_START, env.BLOCKED_END);
  }

  return jsonResponse({ available });
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
  const pendingVerificationResponse = {
    ok: true,
    status: "pending_verification",
    message:
      "Thank you for submitting your documents. Our team is reviewing your verification and will get back to you promptly.",
  };

  try {
    const url = new URL(request.url);
    const requestId = url.searchParams.get("requestId");
    const safeRequestId = typeof requestId === "string" ? requestId.trim() : "";

    if (!safeRequestId) {
      return jsonResponse({
        ok: false,
        status: "missing_request_id",
        message:
          "We received your verification return, but could not locate your booking request.",
      });
    }

    const bookingRaw = await env.BOOKINGS.get(safeRequestId);
    if (bookingRaw == null) {
      return jsonResponse(pendingVerificationResponse);
    }

    let booking = {};
    if (typeof bookingRaw === "string" && bookingRaw) {
      try {
        const parsed = JSON.parse(bookingRaw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          booking = parsed;
        }
      } catch (error) {
        console.error("Booking status parse error:", error);
      }
    }

    const statusValue = typeof booking.status === "string" ? booking.status.trim().toLowerCase() : "";
    const existingStatus = statusValue || "unknown";

    const checkin =
      typeof booking.checkin === "string"
        ? booking.checkin
        : typeof booking.checkIn === "string"
        ? booking.checkIn
        : typeof booking.check_in === "string"
        ? booking.check_in
        : null;

    const checkout =
      typeof booking.checkout === "string"
        ? booking.checkout
        : typeof booking.checkOut === "string"
        ? booking.checkOut
        : typeof booking.check_out === "string"
        ? booking.check_out
        : null;

    return jsonResponse({
      ok: true,
      status: existingStatus,
      message: getStatusMessage(existingStatus),
      requestId: safeRequestId,
      checkin,
      checkout,
    });
  } catch (error) {
    console.error("Booking status handler error:", error);
    return jsonResponse(pendingVerificationResponse);
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
  const queryRequestId = (url.searchParams.get("requestId") || "").trim();
  const requestId = bodyRequestId || queryRequestId || createRequestId();

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

  const params = new URLSearchParams();
  params.set("type", "document");
  params.set("metadata[requestId]", requestId);
  if (env.IDENTITY_RETURN_URL) {
    params.set("return_url", env.IDENTITY_RETURN_URL);
  }

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

  return jsonResponse({ url: stripeData.url });
}

async function handleWebhook(request) {
  let event;
  try {
    event = await request.json();
  } catch (error) {
    console.error("Webhook JSON parse error:", error);
    return new Response("Invalid payload", { status: 400 });
  }

  const eventType = event && typeof event.type === "string" ? event.type : "";

  if (
    eventType !== "identity.verification_session.verified" &&
    eventType !== "identity.verification_session.requires_input" &&
    eventType !== "identity.verification_session.canceled"
  ) {
    return new Response("Webhook received", { status: 200 });
  }

  const session = event && event.data ? event.data.object : null;
  const requestId = session?.metadata?.requestId;

  console.log(eventType, requestId);

  if (!requestId) {
    return new Response("Missing requestId", { status: 400 });
  }

  if (eventType === "identity.verification_session.verified") {
    BOOKINGS[requestId] = { status: "verified" };
  }

  if (eventType === "identity.verification_session.requires_input") {
    BOOKINGS[requestId] = { status: "requires_input" };
  }

  if (eventType === "identity.verification_session.canceled") {
    BOOKINGS[requestId] = { status: "rejected" };
  }

  return new Response("Webhook received", { status: 200 });
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
      return handleWebhook(request);
    }

    if (pathname.includes("webhook") && method === "POST") {
      return handleWebhook(request);
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

    if (pathname.includes("verify") && method === "POST") {
      return handleCreateVerificationSession(request, env);
    }

    if (pathname.includes("get-booking") && method === "GET") {
      return handleGetBooking(request, env);
    }

    if (method === "GET" && isBookingStatusPath(pathname)) {
      return handleBookingStatus(request, env);
    }

    return textResponse("Not found", 404);
  },
};
