const API_BASE_URL = "https://luxhouse-worker.tech-e7b.workers.dev";
const LATEST_BOOKING_STORAGE_KEY = "luxhouse.latestBooking";
const NIGHTLY_RATES = {
  cactus: 625,
  pine: 710
};

let bookingModalController = null;

function normalizeDestination(value) {
  const raw = String(value || "").toLowerCase().trim();
  if (raw.includes("pine")) {
    return "pine";
  }
  if (raw.includes("cactus")) {
    return "cactus";
  }
  return "";
}

function getDestinationLabel(destination) {
  const normalized = normalizeDestination(destination);
  if (normalized === "cactus") {
    return "Cactus & Chill House";
  }
  if (normalized === "pine") {
    return "Pine & Peace House";
  }
  return "";
}

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(isoDate, days) {
  const base = new Date(`${isoDate}T00:00:00`);
  base.setDate(base.getDate() + days);
  return formatDateISO(base);
}

function nightsBetween(checkin, checkout) {
  if (!checkin || !checkout) {
    return 0;
  }
  const inDate = new Date(`${checkin}T00:00:00`);
  const outDate = new Date(`${checkout}T00:00:00`);
  const diff = outDate.getTime() - inDate.getTime();
  if (!Number.isFinite(diff) || diff <= 0) {
    return 0;
  }
  return Math.round(diff / 86400000);
}

function setAvailabilityResult(resultEl, message, kind) {
  if (!resultEl) {
    return;
  }
  resultEl.textContent = message || "";
  resultEl.classList.remove("loading", "success", "error");
  if (kind) {
    resultEl.classList.add(kind);
  }
}

function setStatusMessage(statusEl, message, type) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message || "";
  statusEl.classList.remove("is-success", "is-error");
  if (type === "success") {
    statusEl.classList.add("is-success");
  }
  if (type === "error") {
    statusEl.classList.add("is-error");
  }
}

function coerceGuests(raw) {
  const guests = Number(raw);
  if (!Number.isFinite(guests) || guests < 1) {
    return 1;
  }
  if (guests > 20) {
    return 20;
  }
  return Math.round(guests);
}

function enforceDateOrder(checkinInput, checkoutInput) {
  if (!checkinInput || !checkoutInput) {
    return;
  }
  const today = formatDateISO(new Date());
  checkinInput.min = today;

  if (!checkinInput.value) {
    checkinInput.value = today;
  }

  const minCheckout = addDays(checkinInput.value, 1);
  checkoutInput.min = minCheckout;
  if (!checkoutInput.value || checkoutInput.value <= checkinInput.value) {
    checkoutInput.value = minCheckout;
  }
}

function validateStayInputs({ destination, checkin, checkout, guests }) {
  if (!normalizeDestination(destination)) {
    return "Please select a destination.";
  }
  if (!checkin || !checkout) {
    return "Please select check-in and check-out dates.";
  }
  if (checkout <= checkin) {
    return "Check-out must be after check-in.";
  }
  if (!Number.isFinite(guests) || guests < 1) {
    return "Please enter a valid guest count.";
  }
  return "";
}

async function postJson(path, payload) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });

  let data = {};
  try {
    data = await response.json();
  } catch (_) {
    data = {};
  }

  if (!response.ok) {
    const message = data.error || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function createVerificationSession(payload) {
  try {
    return await postJson("/create-verification-session", payload);
  } catch (error) {
    if (error && error.status === 404) {
      return postJson("/verify", payload);
    }
    throw error;
  }
}

function persistLatestBooking(booking) {
  try {
    localStorage.setItem(LATEST_BOOKING_STORAGE_KEY, JSON.stringify(booking));
  } catch (_) {
    // Ignore storage failures.
  }
}

function getLatestBooking() {
  try {
    const raw = localStorage.getItem(LATEST_BOOKING_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function initHeroBookingBar() {
  const bookingForm = document.getElementById("bookingForm");
  if (!bookingForm) {
    return;
  }

  const destinationInput = document.getElementById("destinationSelect");
  const checkinInput = document.getElementById("checkInDate");
  const checkoutInput = document.getElementById("checkOutDate");
  const guestsInput = document.getElementById("guestCount");
  const increaseBtn = document.getElementById("increaseGuests");
  const decreaseBtn = document.getElementById("decreaseGuests");
  const resultEl = document.getElementById("homeAvailabilityResult");
  const feedbackEl = document.getElementById("bookingFeedback");

  if (increaseBtn && guestsInput) {
    increaseBtn.addEventListener("click", () => {
      const nextGuests = Math.min(20, coerceGuests(guestsInput.value) + 1);
      guestsInput.value = String(nextGuests);
    });
  }

  if (decreaseBtn && guestsInput) {
    decreaseBtn.addEventListener("click", () => {
      const nextGuests = Math.max(1, coerceGuests(guestsInput.value) - 1);
      guestsInput.value = String(nextGuests);
    });
  }

  if (checkinInput && checkoutInput) {
    enforceDateOrder(checkinInput, checkoutInput);
    checkinInput.addEventListener("change", () => {
      enforceDateOrder(checkinInput, checkoutInput);
    });
  }

  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      destination: destinationInput ? destinationInput.value : "",
      checkin: checkinInput ? checkinInput.value : "",
      checkout: checkoutInput ? checkoutInput.value : "",
      guests: coerceGuests(guestsInput ? guestsInput.value : 1)
    };

    const validationMessage = validateStayInputs(payload);
    if (validationMessage) {
      setAvailabilityResult(resultEl, validationMessage, "error");
      if (feedbackEl) {
        feedbackEl.textContent = validationMessage;
      }
      return;
    }

    setAvailabilityResult(resultEl, "Checking availability...", "loading");
    if (feedbackEl) {
      feedbackEl.textContent = "";
    }

    try {
      const data = await postJson("/availability", {
        checkin: payload.checkin,
        checkout: payload.checkout
      });
      const available = data.available === true;

      if (available) {
        setAvailabilityResult(resultEl, "Available for your dates.", "success");
        if (feedbackEl) {
          feedbackEl.textContent = "Great news - click Book to continue with verification.";
        }
      } else {
        setAvailabilityResult(resultEl, "Not available for these dates.", "error");
        if (feedbackEl) {
          feedbackEl.textContent = "Try different dates, then recheck availability.";
        }
      }
    } catch (error) {
      setAvailabilityResult(resultEl, error.message || "Unable to check availability.", "error");
      if (feedbackEl) {
        feedbackEl.textContent = "We couldn't connect right now. Please try again.";
      }
    }
  });
}

function initBookingModal() {
  const modal = document.getElementById("bookingModal");
  if (!modal) {
    return;
  }

  const form = document.getElementById("bookingModalForm");
  const destinationInput = document.getElementById("modalDestination");
  const checkinInput = document.getElementById("modalCheckin");
  const checkoutInput = document.getElementById("modalCheckout");
  const guestsInput = document.getElementById("modalGuests");
  const availabilityResult = document.getElementById("availabilityResult");
  const statusEl = document.getElementById("bookingStatus");
  const stepTwoEl = document.getElementById("bookingStepTwo");
  const continueBtn =
    document.getElementById("continueBookingBtn") ||
    document.getElementById("continueBtn");
  const checkAvailabilityBtn =
    document.getElementById("checkAvailabilityBtn") ||
    (form ? form.querySelector('button[type="submit"]') : null);

  if (!form || !destinationInput || !checkinInput || !checkoutInput || !guestsInput || !stepTwoEl || !continueBtn) {
    return;
  }

  const addonCheckboxes = Array.from(
    modal.querySelectorAll(".addon-checkbox")
  );

  const state = {
    isAvailable: false
  };

  function getCurrentModalData() {
    const destination = normalizeDestination(destinationInput.value);
    const checkin = checkinInput.value;
    const checkout = checkoutInput.value;
    const guests = coerceGuests(guestsInput.value);
    const nights = nightsBetween(checkin, checkout);
    const nightlyRate = NIGHTLY_RATES[destination] || 0;

    let addonsTotal = 0;
    const activeAddonGroup = stepTwoEl.querySelector(
      `.addons-group[data-property="${destination}"]`
    );
    if (activeAddonGroup) {
      const selected = activeAddonGroup.querySelectorAll(".addon-checkbox:checked");
      selected.forEach((checkbox) => {
        addonsTotal += Number(checkbox.getAttribute("data-price") || 0);
      });
    }

    const total = nights * nightlyRate + addonsTotal;

    return {
      destination,
      checkin,
      checkout,
      guests,
      nights,
      nightlyRate,
      addonsTotal,
      total
    };
  }

  function syncPricingUI() {
    const pricing = getCurrentModalData();

    const nightlyRateEl = document.getElementById("nightlyPriceDisplay");
    const nightsEl = document.getElementById("nightsCount");
    const addonsEl = document.getElementById("addonsTotal");
    const totalEl = document.getElementById("totalPrice");

    if (nightlyRateEl) {
      nightlyRateEl.textContent = String(pricing.nightlyRate);
    }
    if (nightsEl) {
      nightsEl.textContent = String(pricing.nights);
    }
    if (addonsEl) {
      addonsEl.textContent = String(pricing.addonsTotal);
    }
    if (totalEl) {
      totalEl.textContent = String(pricing.total);
    }
  }

  function showDestinationAddons(destination) {
    const normalized = normalizeDestination(destination);
    const groups = stepTwoEl.querySelectorAll(".addons-group");
    groups.forEach((group) => {
      group.hidden = group.getAttribute("data-property") !== normalized;
      if (group.hidden) {
        const checkboxes = group.querySelectorAll(".addon-checkbox");
        checkboxes.forEach((checkbox) => {
          checkbox.checked = false;
        });
      }
    });
    syncPricingUI();
  }

  function resetModalState() {
    state.isAvailable = false;
    stepTwoEl.hidden = true;
    continueBtn.disabled = true;
    setAvailabilityResult(availabilityResult, "", "");
    setStatusMessage(statusEl, "", "");
    addonCheckboxes.forEach((checkbox) => {
      checkbox.checked = false;
    });
    showDestinationAddons(destinationInput.value);
    syncPricingUI();
  }

  function openModal(prefill) {
    const prefillData = prefill || {};
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    enforceDateOrder(checkinInput, checkoutInput);
    resetModalState();

    if (prefillData.destination) {
      destinationInput.value = normalizeDestination(prefillData.destination);
    }

    if (prefillData.checkin) {
      checkinInput.value = prefillData.checkin;
    }

    enforceDateOrder(checkinInput, checkoutInput);

    if (prefillData.checkout) {
      checkoutInput.value = prefillData.checkout;
    }

    if (prefillData.guests) {
      guestsInput.value = String(coerceGuests(prefillData.guests));
    }

    showDestinationAddons(destinationInput.value);
    syncPricingUI();
  }

  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  async function handleAvailabilityCheck(event) {
    event.preventDefault();
    const modalData = getCurrentModalData();
    const validationMessage = validateStayInputs(modalData);

    if (validationMessage) {
      state.isAvailable = false;
      stepTwoEl.hidden = true;
      continueBtn.disabled = true;
      setAvailabilityResult(availabilityResult, validationMessage, "error");
      setStatusMessage(statusEl, validationMessage, "error");
      return;
    }

    if (checkAvailabilityBtn) {
      checkAvailabilityBtn.disabled = true;
    }
    continueBtn.disabled = true;
    setAvailabilityResult(availabilityResult, "Checking availability...", "loading");
    setStatusMessage(statusEl, "Checking your dates...", "");

    try {
      const data = await postJson("/availability", {
        checkin: modalData.checkin,
        checkout: modalData.checkout
      });

      const available = data.available === true;
      state.isAvailable = available;

      if (available) {
        stepTwoEl.hidden = false;
        continueBtn.disabled = false;
        showDestinationAddons(modalData.destination);
        syncPricingUI();
        setAvailabilityResult(availabilityResult, "Available for your dates", "success");
        setStatusMessage(
          statusEl,
          "Available. Enhance your stay and continue to Stripe verification.",
          "success"
        );
      } else {
        stepTwoEl.hidden = true;
        continueBtn.disabled = true;
        setAvailabilityResult(availabilityResult, "Not available for these dates", "error");
        setStatusMessage(
          statusEl,
          "Those dates are unavailable. Try different dates.",
          "error"
        );
      }
    } catch (error) {
      state.isAvailable = false;
      stepTwoEl.hidden = true;
      continueBtn.disabled = true;
      setAvailabilityResult(
        availabilityResult,
        error.message || "Unable to check availability right now.",
        "error"
      );
      setStatusMessage(
        statusEl,
        "Could not verify availability right now. Please try again.",
        "error"
      );
    } finally {
      if (checkAvailabilityBtn) {
        checkAvailabilityBtn.disabled = false;
      }
    }
  }

  async function handleContinueToBooking(event) {
    event.preventDefault();

    const modalData = getCurrentModalData();
    const validationMessage = validateStayInputs(modalData);
    if (validationMessage) {
      setStatusMessage(statusEl, validationMessage, "error");
      return;
    }

    if (!state.isAvailable) {
      setStatusMessage(
        statusEl,
        "Please confirm availability before continuing to booking.",
        "error"
      );
      return;
    }

    continueBtn.disabled = true;
    if (checkAvailabilityBtn) {
      checkAvailabilityBtn.disabled = true;
    }
    setStatusMessage(statusEl, "Creating your booking request...", "");

    const requestId = `LUX-${Date.now()}`;

    try {
      persistLatestBooking({
        requestId,
        destination: modalData.destination,
        destinationLabel: getDestinationLabel(modalData.destination),
        checkin: modalData.checkin,
        checkout: modalData.checkout,
        guests: modalData.guests,
        nights: modalData.nights,
        nightlyRate: modalData.nightlyRate,
        addonsTotal: modalData.addonsTotal,
        total: modalData.total,
        createdAt: new Date().toISOString()
      });

      setStatusMessage(statusEl, "Launching Stripe verification...", "success");
      const verificationData = await createVerificationSession({
        requestId,
        checkin: modalData.checkin,
        checkout: modalData.checkout,
        destination: modalData.destination,
        guests: modalData.guests,
        addonsTotal: modalData.addonsTotal,
        total: modalData.total,
        returnUrl: `${window.location.origin}/booking-status.html`
      });

      if (verificationData.url) {
        window.location.assign(verificationData.url);
        return;
      }

      window.location.assign(
        `booking-status.html?requestId=${encodeURIComponent(requestId)}`
      );
    } catch (error) {
      setStatusMessage(
        statusEl,
        error.message || "Could not start verification. Please try again.",
        "error"
      );
      persistLatestBooking({
        requestId,
        ...modalData,
        destinationLabel: getDestinationLabel(modalData.destination),
        createdAt: new Date().toISOString()
      });
      continueBtn.disabled = false;
      if (checkAvailabilityBtn) {
        checkAvailabilityBtn.disabled = false;
      }
    }
  }

  const openTriggers = document.querySelectorAll("[data-open-booking-modal]");
  openTriggers.forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();

      const prefill = {
        destination: trigger.getAttribute("data-booking-destination") || ""
      };

      openModal(prefill);
    });
  });

  const closeTriggers = modal.querySelectorAll("[data-close-booking-modal]");
  closeTriggers.forEach((trigger) => {
    trigger.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("is-open")) {
      closeModal();
    }
  });

  form.addEventListener("submit", handleAvailabilityCheck);
  continueBtn.addEventListener("click", handleContinueToBooking);

  destinationInput.addEventListener("change", () => {
    state.isAvailable = false;
    stepTwoEl.hidden = true;
    continueBtn.disabled = true;
    showDestinationAddons(destinationInput.value);
    setAvailabilityResult(availabilityResult, "", "");
    setStatusMessage(statusEl, "", "");
  });

  checkinInput.addEventListener("change", () => {
    state.isAvailable = false;
    stepTwoEl.hidden = true;
    continueBtn.disabled = true;
    enforceDateOrder(checkinInput, checkoutInput);
    syncPricingUI();
    setAvailabilityResult(availabilityResult, "", "");
    setStatusMessage(statusEl, "", "");
  });

  checkoutInput.addEventListener("change", () => {
    state.isAvailable = false;
    stepTwoEl.hidden = true;
    continueBtn.disabled = true;
    syncPricingUI();
    setAvailabilityResult(availabilityResult, "", "");
    setStatusMessage(statusEl, "", "");
  });

  guestsInput.addEventListener("change", () => {
    guestsInput.value = String(coerceGuests(guestsInput.value));
  });

  addonCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      syncPricingUI();
    });
  });

  enforceDateOrder(checkinInput, checkoutInput);
  resetModalState();

  bookingModalController = {
    open: openModal
  };
}

function initPropertyForms() {
  const forms = [
    { id: "pineBookingForm", destination: "pine" },
    { id: "cactusBookingForm", destination: "cactus" }
  ];

  forms.forEach((item) => {
    const form = document.getElementById(item.id);
    if (!form) {
      return;
    }

    const checkinInput = form.querySelector('[name="checkin"]');
    const checkoutInput = form.querySelector('[name="checkout"]');
    const guestsInput = form.querySelector('[name="guests"]');

    if (checkinInput && checkoutInput) {
      enforceDateOrder(checkinInput, checkoutInput);
      checkinInput.addEventListener("change", () => {
        enforceDateOrder(checkinInput, checkoutInput);
      });
    }

    let resultEl = form.nextElementSibling;
    if (!resultEl || !resultEl.classList || !resultEl.classList.contains("availability-result")) {
      resultEl = document.createElement("p");
      resultEl.className = "availability-result";
      form.insertAdjacentElement("afterend", resultEl);
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const payload = {
        destination: item.destination,
        checkin: checkinInput ? checkinInput.value : "",
        checkout: checkoutInput ? checkoutInput.value : "",
        guests: coerceGuests(guestsInput ? guestsInput.value : 1)
      };

      const validationMessage = validateStayInputs(payload);
      if (validationMessage) {
        setAvailabilityResult(resultEl, validationMessage, "error");
        return;
      }

      setAvailabilityResult(resultEl, "Checking availability...", "loading");

      try {
        const data = await postJson("/availability", {
          checkin: payload.checkin,
          checkout: payload.checkout
        });

        if (data.available === true) {
          setAvailabilityResult(
            resultEl,
            "Available. Opening booking flow...",
            "success"
          );
          if (bookingModalController && bookingModalController.open) {
            bookingModalController.open(payload);
          }
        } else {
          setAvailabilityResult(resultEl, "Not available for these dates.", "error");
        }
      } catch (error) {
        setAvailabilityResult(
          resultEl,
          error.message || "Unable to check availability right now.",
          "error"
        );
      }
    });
  });
}

function initBookingSummaryPage() {
  const destinationEl = document.getElementById("summaryDestination");
  const checkinEl = document.getElementById("summaryCheckin");
  const checkoutEl = document.getElementById("summaryCheckout");
  const guestsEl = document.getElementById("summaryGuests");
  const requestForm = document.getElementById("bookingRequestForm");
  const nameInput = document.getElementById("bookingGuestName");
  const emailInput = document.getElementById("bookingGuestEmail");
  const phoneInput = document.getElementById("bookingGuestPhone");
  const notesInput = document.getElementById("bookingGuestNotes");
  const submitRequestBtn = document.getElementById("submitBookingRequestBtn");
  const requestStatusEl = document.getElementById("bookingRequestStatus");

  if (!destinationEl || !checkinEl || !checkoutEl || !guestsEl) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const latest = getLatestBooking() || {};
  const destinationParam = params.get("destination") || "";
  const normalizedDestination =
    normalizeDestination(destinationParam) ||
    normalizeDestination(latest.destination) ||
    "";
  const destinationLabel =
    getDestinationLabel(destinationParam) ||
    getDestinationLabel(normalizedDestination) ||
    latest.destinationLabel ||
    "-";

  const requestId =
    params.get("requestId") ||
    latest.requestId ||
    `LUX-${Date.now()}`;

  const checkin = params.get("checkin") || latest.checkin || "-";
  const checkout = params.get("checkout") || latest.checkout || "-";
  const guests = params.get("guests") || latest.guests || "-";

  destinationEl.textContent = destinationLabel;
  checkinEl.textContent = checkin;
  checkoutEl.textContent = checkout;
  guestsEl.textContent = String(guests);

  if (nameInput && typeof latest.guestName === "string") {
    nameInput.value = latest.guestName;
  }
  if (emailInput && typeof latest.guestEmail === "string") {
    emailInput.value = latest.guestEmail;
  }
  if (phoneInput && typeof latest.guestPhone === "string") {
    phoneInput.value = latest.guestPhone;
  }
  if (notesInput && typeof latest.notes === "string") {
    notesInput.value = latest.notes;
  }

  function setRequestStatus(message, type) {
    if (!requestStatusEl) {
      return;
    }
    requestStatusEl.textContent = message || "";
    requestStatusEl.style.color = "#4b5563";
    if (type === "success") {
      requestStatusEl.style.color = "#15803d";
    }
    if (type === "error") {
      requestStatusEl.style.color = "#b91c1c";
    }
  }

  if (!requestForm || !nameInput || !emailInput || !phoneInput || !submitRequestBtn) {
    return;
  }

  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const guestName = nameInput.value.trim();
    const guestEmail = emailInput.value.trim();
    const guestPhone = phoneInput.value.trim();
    const notes = notesInput ? notesInput.value.trim() : "";

    if (!guestName || !guestEmail || !guestPhone) {
      setRequestStatus("Please complete your name, email, and phone number.", "error");
      return;
    }

    submitRequestBtn.disabled = true;
    setRequestStatus("Submitting your booking request and preparing secure payment...", "");

    const payload = {
      requestId,
      destination: normalizedDestination,
      destinationLabel,
      checkin,
      checkout,
      guests: coerceGuests(guests),
      total: Number(latest.total) || 0,
      guestName,
      guestEmail,
      guestPhone,
      notes,
    };

    try {
      persistLatestBooking({
        ...latest,
        ...payload,
        requestId,
        destination: normalizedDestination || latest.destination || "",
        destinationLabel,
        updatedAt: new Date().toISOString(),
      });

      const paymentData = await postJson("/create-payment-session", payload);
      if (paymentData && paymentData.url) {
        setRequestStatus("Redirecting to Stripe payment...", "success");
        window.location.assign(paymentData.url);
        return;
      }

      throw new Error("Payment session was created, but no redirect URL was returned.");
    } catch (error) {
      console.error("Booking request submission failed:", error);
      setRequestStatus(
        error && error.message
          ? error.message
          : "We could not start payment right now. Please try again.",
        "error"
      );
      submitRequestBtn.disabled = false;
    }
  });

  if (params.get("payment") === "success") {
    setRequestStatus("Payment completed. Thank you - our team will confirm your booking shortly.", "success");
    submitRequestBtn.disabled = true;
  }

  if (params.get("payment") === "cancelled") {
    setRequestStatus("Payment was cancelled. You can submit again when ready.", "error");
    if (submitRequestBtn) {
      submitRequestBtn.disabled = false;
    }
  }

  if (window.location.hash === "#payment") {
    setTimeout(() => {
      requestForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function init() {
  if (window.__luxBookingInitDone) {
    return;
  }
  window.__luxBookingInitDone = true;

  initHeroBookingBar();
  initBookingModal();
  initPropertyForms();
  initBookingSummaryPage();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
