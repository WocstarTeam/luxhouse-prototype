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

    if (method === "GET" && isBookingStatusPath(pathname)) {
      return handleBookingStatus(request, env);
    }

    return textResponse("Not found", 404);
  },
};
