function resolveFormForElement(element) {
  if (!element) {
    return null;
  }
  return element.closest("form");
}

function resolveInputValue(form, name) {
  const scoped = form ? form.querySelector(`[name="${name}"]`) : null;
  const fallback = document.querySelector(`[name="${name}"]`);
  const input = scoped || fallback;
  return input ? input.value : "";
}

async function checkAvailability(event) {
  if (event) {
    event.preventDefault();
  }

  console.log("CLICK TRIGGERED");

  const form = resolveFormForElement(event ? event.currentTarget : null);
  const checkin = resolveInputValue(form, "checkin");
  const checkout = resolveInputValue(form, "checkout");
  const result = document.getElementById("availabilityResult");

  if (!result) {
    console.error("Missing #availabilityResult");
    return;
  }

  const payload = { checkin, checkout };
  console.log("Sending:", payload);

  try {
    const res = await fetch("https://restless-waterfall-a71b.tech-e7b.workers.dev/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log("FETCH RESPONSE", data);

    result.textContent = data.available === true
      ? "Available for your dates"
      : "Not available";
  } catch (err) {
    console.error("Availability error:", err);
    result.textContent = "Not available";
  }
}

async function continueToBooking(event) {
  if (event) {
    event.preventDefault();
  }

  console.log("CLICK TRIGGERED");

  const requestId = "LUX-" + Date.now();
  const payload = { requestId };
  console.log("Sending:", payload);

  try {
    const res = await fetch("https://restless-waterfall-a71b.tech-e7b.workers.dev/create-verification-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log("FETCH RESPONSE", data);

    if (data.url) {
      window.location.href = data.url;
      return;
    }

    console.error("No verification URL returned");
  } catch (err) {
    console.error("Booking error:", err);
  }
}

function init() {
  if (window.__luxBookingInitDone) {
    return;
  }
  window.__luxBookingInitDone = true;

  console.log("INIT RUNNING");

  const checkBtn = document.getElementById("checkAvailabilityBtn");
  const continueBtn = document.getElementById("continueBtn");

  if (!checkBtn) {
    console.error("Missing button: #checkAvailabilityBtn");
  } else {
    console.log("BUTTON FOUND", "checkAvailabilityBtn");
    checkBtn.addEventListener("click", checkAvailability);
  }

  if (!continueBtn) {
    console.error("Missing button: #continueBtn");
  } else {
    console.log("BUTTON FOUND", "continueBtn");
    continueBtn.addEventListener("click", continueToBooking);
  }
}

if (document.readyState !== "loading") {
  init();
} else {
  document.addEventListener("DOMContentLoaded", init);
}
