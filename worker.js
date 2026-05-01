const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

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

async function handleWebhook(request, env) {
  try {
    const event = await request.json();

    if (event.type === "identity.verification_session.verified") {
      const requestId = event.data?.object?.metadata?.requestId;
      if (requestId) {
        const existingRaw = await env.BOOKINGS.get(requestId);
        const booking = existingRaw ? JSON.parse(existingRaw) : { requestId };
        booking.status = "approved";
        await env.BOOKINGS.put(requestId, JSON.stringify(booking));
      }
    }

    if (event.type === "identity.verification_session.requires_input") {
      const requestId = event.data?.object?.metadata?.requestId;
      if (requestId) {
        const existingRaw = await env.BOOKINGS.get(requestId);
        const booking = existingRaw ? JSON.parse(existingRaw) : { requestId };
        booking.status = "rejected";
        await env.BOOKINGS.put(requestId, JSON.stringify(booking));
      }
    }
  } catch (error) {
    console.error("Webhook handler error:", error);
  }

  return new Response("ok", { status: 200 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
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

    if (pathname.includes("verify") && method === "POST") {
      return handleCreateVerificationSession(request, env);
    }

    if (pathname.includes("get-booking") && method === "GET") {
      return handleGetBooking(request, env);
    }

    return textResponse("Not found", 404);
  },
};
