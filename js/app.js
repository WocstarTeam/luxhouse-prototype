const API_BASE_URL = "https://luxhouse-worker.tech-e7b.workers.dev";
const LATEST_BOOKING_STORAGE_KEY = "luxhouse.latestBooking";
const MIN_STAY_NIGHTS = 2;
const MAX_STAY_NIGHTS = 28;
const NIGHTLY_RATES = {
  cactus: 625,
  pine: 710
};
const FEATURE_FLAGS = Object.freeze({
  pineEnabled: false
});
const PINE_COMING_SOON_MESSAGE =
  "Pine & Peace House is opening soon. Please book Cactus & Chill House for now.";

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

function isPineEnabled() {
  return FEATURE_FLAGS.pineEnabled === true;
}

function isDestinationEnabled(value) {
  const normalized = normalizeDestination(value);
  if (!normalized) {
    return false;
  }
  if (normalized === "pine" && !isPineEnabled()) {
    return false;
  }
  return true;
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

function maskPineContentUntilLaunch() {
  if (isPineEnabled()) {
    return;
  }

  const body = document.body;
  if (body && body.classList.contains("lux-pine-page")) {
    body.className = "lux-home-page";
    body.innerHTML = `
      <main style="min-height:100svh;display:grid;place-items:center;padding:1.4rem;background:#f7f2ea;color:#2b231e;font-family:'Manrope','Segoe UI',sans-serif;">
        <section style="width:min(92vw,640px);background:#fffaf3;border:1px solid #d6c7b2;box-shadow:0 20px 48px rgba(33,21,12,0.14);padding:1.5rem;text-align:center;">
          <p style="margin:0;text-transform:uppercase;letter-spacing:0.1em;font-size:0.72rem;color:#2f5a52;font-weight:700;">The LuxHouse Collection</p>
          <h1 style="margin:0.65rem 0 0;font-family:'Cormorant Garamond',Georgia,serif;font-size:clamp(2rem,5.3vw,3rem);line-height:1.05;">Pine &amp; Peace House<br>Coming Soon</h1>
          <p style="margin:0.9rem auto 0;max-width:38ch;color:#68584a;">${PINE_COMING_SOON_MESSAGE}</p>
          <a href="index.html" style="display:inline-block;margin-top:1.15rem;text-decoration:none;border:1px solid #d6c7b2;background:#fff9f1;color:#2b231e;padding:0.62rem 0.92rem;font-size:0.82rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Back to Collection</a>
        </section>
      </main>
    `;
    return;
  }

  document.querySelectorAll("[data-pine-content]").forEach((element) => {
    element.remove();
  });

  document
    .querySelectorAll('option[value="pine"], option[value="pine-and-peace"]')
    .forEach((option) => {
      option.remove();
    });

  document.querySelectorAll(".addons-group[data-property=\"pine\"]").forEach((group) => {
    group.remove();
  });

  const heroLines = Array.from(document.querySelectorAll(".hero-line"));
  if (heroLines.length >= 4) {
    heroLines[0].textContent = "Signature";
    heroLines[1].textContent = "desert";
    heroLines[2].textContent = "guesthouse";
    heroLines[3].textContent = "luxury standard.";
  }
  const heroSummary = document.querySelector(".hero-summary");
  if (heroSummary) {
    heroSummary.textContent =
      "Cactus & Chill offers warm design, elevated comfort, and effortless group hosting.";
  }

  const track = document.getElementById("destinationCarouselTrack");
  if (track) {
    const slides = Array.from(track.querySelectorAll(".destination-slide"));
    slides.forEach((slide, index) => {
      slide.setAttribute("data-destination-index", String(index));
      slide.setAttribute("aria-hidden", String(index !== 0));
      slide.classList.toggle("is-active", index === 0);
    });
  }

  const dots = Array.from(
    document.querySelectorAll(".destination-carousel-dot")
  );
  dots.forEach((dot, index) => {
    dot.setAttribute("data-destination-index", String(index));
    const isActive = index === 0;
    dot.classList.toggle("is-active", isActive);
    dot.setAttribute("aria-selected", String(isActive));
    dot.setAttribute("tabindex", isActive ? "0" : "-1");
  });
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

function formatCurrency(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return numeric.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

function formatShortDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
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

  const minCheckout = addDays(checkinInput.value, MIN_STAY_NIGHTS);
  const maxCheckout = addDays(checkinInput.value, MAX_STAY_NIGHTS);
  checkoutInput.min = minCheckout;
  checkoutInput.max = maxCheckout;
  if (
    !checkoutInput.value ||
    checkoutInput.value <= checkinInput.value ||
    checkoutInput.value < minCheckout ||
    checkoutInput.value > maxCheckout
  ) {
    checkoutInput.value = minCheckout;
  }
}

function validateStayInputs({ destination, checkin, checkout, guests }) {
  const normalizedDestination = normalizeDestination(destination);
  if (!normalizedDestination) {
    return "Please select a destination.";
  }
  if (!isDestinationEnabled(normalizedDestination)) {
    return PINE_COMING_SOON_MESSAGE;
  }
  if (!checkin || !checkout) {
    return "Please select check-in and check-out dates.";
  }
  if (checkout <= checkin) {
    return "Check-out must be after check-in.";
  }
  const nights = nightsBetween(checkin, checkout);
  if (nights < MIN_STAY_NIGHTS) {
    return `The minimum stay is ${MIN_STAY_NIGHTS} nights.`;
  }
  if (nights > MAX_STAY_NIGHTS) {
    return `The maximum stay is ${MAX_STAY_NIGHTS} nights.`;
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
    if (data && typeof data.code === "string") {
      error.code = data.code;
    }
    if (data && data.debug && typeof data.debug === "object") {
      error.debug = data.debug;
    }
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
        destination: payload.destination,
        checkin: payload.checkin,
        checkout: payload.checkout
      });
      const available = data.available === true;

      if (available) {
        setAvailabilityResult(resultEl, "Available for your dates.", "success");
        if (feedbackEl) {
          feedbackEl.textContent = "Great news. We are opening your pricing and stay options now.";
        }
        if (bookingModalController && bookingModalController.open) {
          bookingModalController.open(payload, { availabilityConfirmed: true });
        }
      } else {
        setAvailabilityResult(resultEl, "", "");
        if (feedbackEl) {
          feedbackEl.textContent = "Those dates are unavailable. Opening suggested alternatives now.";
        }
        if (bookingModalController && bookingModalController.open) {
          bookingModalController.open(payload, { autoCheck: true });
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

function initFeaturedDestinationImageRotator() {
  const rotator = document.getElementById("featuredDestinationRotator");
  if (!rotator) {
    return;
  }

  const frames = Array.from(rotator.querySelectorAll(".destination-rotator-image"));
  if (frames.length < 2) {
    return;
  }

  let activeIndex = 0;
  let timer = null;
  const dwellMs = 3800;

  function showFrame(index) {
    activeIndex = (index + frames.length) % frames.length;
    frames.forEach((frame, frameIndex) => {
      const isActive = frameIndex === activeIndex;
      frame.classList.toggle("is-active", isActive);
      frame.setAttribute("aria-hidden", String(!isActive));
    });
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function start() {
    stop();
    timer = window.setInterval(() => {
      showFrame(activeIndex + 1);
    }, dwellMs);
  }

  showFrame(0);
  start();
}

function initDestinationCarousel() {
  const root = document.getElementById("destinationCarousel");
  const track = document.getElementById("destinationCarouselTrack");
  const controls = root ? root.querySelector(".destination-carousel-controls") : null;
  const prevBtn = document.getElementById("destinationPrevBtn");
  const nextBtn = document.getElementById("destinationNextBtn");
  if (!root || !track || !prevBtn || !nextBtn) {
    return;
  }

  const slides = Array.from(track.querySelectorAll(".destination-slide"));
  const dots = Array.from(root.querySelectorAll(".destination-carousel-dot"));
  if (!slides.length) {
    return;
  }

  if (slides.length < 2) {
    if (controls) {
      controls.hidden = true;
    }
    track.style.transform = "translateX(0)";
    slides[0].classList.add("is-active");
    slides[0].setAttribute("aria-hidden", "false");
    return;
  }

  let currentIndex = 0;
  let autoTimer = null;
  const prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function renderSlide(index) {
    currentIndex = (index + slides.length) % slides.length;
    track.style.transform = `translateX(-${currentIndex * 100}%)`;

    slides.forEach((slide, slideIndex) => {
      const isActive = slideIndex === currentIndex;
      slide.classList.toggle("is-active", isActive);
      slide.setAttribute("aria-hidden", String(!isActive));
    });

    dots.forEach((dot, dotIndex) => {
      const isActive = dotIndex === currentIndex;
      dot.classList.toggle("is-active", isActive);
      dot.setAttribute("aria-selected", String(isActive));
      dot.setAttribute("tabindex", isActive ? "0" : "-1");
    });
  }

  function stopAutoRotate() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  function startAutoRotate() {
    if (prefersReducedMotion || slides.length < 2) {
      return;
    }
    stopAutoRotate();
    autoTimer = window.setInterval(() => {
      renderSlide(currentIndex + 1);
    }, 6500);
  }

  function goToRelativeSlide(step) {
    renderSlide(currentIndex + step);
    startAutoRotate();
  }

  prevBtn.addEventListener("click", () => {
    goToRelativeSlide(-1);
  });

  nextBtn.addEventListener("click", () => {
    goToRelativeSlide(1);
  });

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const nextIndex = Number(dot.getAttribute("data-destination-index"));
      if (!Number.isFinite(nextIndex)) {
        return;
      }
      renderSlide(nextIndex);
      startAutoRotate();
    });
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goToRelativeSlide(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goToRelativeSlide(1);
    }
  });

  root.addEventListener("mouseenter", stopAutoRotate);
  root.addEventListener("mouseleave", startAutoRotate);
  root.addEventListener("focusin", stopAutoRotate);
  root.addEventListener("focusout", (event) => {
    if (root.contains(event.relatedTarget)) {
      return;
    }
    startAutoRotate();
  });

  renderSlide(0);
  startAutoRotate();
}

function initEditorialTestimonials() {
  const root = document.getElementById("testimonialCarousel");
  const track = document.getElementById("testimonialCarouselTrack");
  const prevBtn = document.getElementById("testimonialPrevBtn");
  const nextBtn = document.getElementById("testimonialNextBtn");
  const currentIndexEl = document.getElementById("testimonialCurrentIndex");
  const totalCountEl = document.getElementById("testimonialTotalCount");
  const controls = root ? root.querySelector(".editorial-testimonial-controls") : null;
  if (!root || !track || !prevBtn || !nextBtn) {
    return;
  }

  const slides = Array.from(track.querySelectorAll(".editorial-testimonial-slide"));
  const dots = Array.from(root.querySelectorAll(".editorial-testimonial-dot"));
  if (!slides.length) {
    return;
  }

  function formatIndex(index) {
    return String(index).padStart(2, "0");
  }

  if (totalCountEl) {
    totalCountEl.textContent = formatIndex(slides.length);
  }

  if (slides.length < 2) {
    if (controls) {
      controls.hidden = true;
    }
    track.style.transform = "translateX(0)";
    slides[0].classList.add("is-active");
    slides[0].setAttribute("aria-hidden", "false");
    if (currentIndexEl) {
      currentIndexEl.textContent = "01";
    }
    return;
  }

  let currentIndex = 0;
  let autoTimer = null;
  const dwellMs = 5600;
  const prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function renderSlide(index) {
    currentIndex = (index + slides.length) % slides.length;
    track.style.transform = `translateX(-${currentIndex * 100}%)`;
    if (currentIndexEl) {
      currentIndexEl.textContent = formatIndex(currentIndex + 1);
    }

    slides.forEach((slide, slideIndex) => {
      const isActive = slideIndex === currentIndex;
      slide.classList.toggle("is-active", isActive);
      slide.setAttribute("aria-hidden", String(!isActive));
    });

    dots.forEach((dot, dotIndex) => {
      const isActive = dotIndex === currentIndex;
      dot.classList.toggle("is-active", isActive);
      dot.setAttribute("aria-selected", String(isActive));
      dot.setAttribute("tabindex", isActive ? "0" : "-1");
    });
  }

  function stopAutoRotate() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  function startAutoRotate() {
    if (prefersReducedMotion || slides.length < 2) {
      return;
    }
    stopAutoRotate();
    autoTimer = window.setInterval(() => {
      renderSlide(currentIndex + 1);
    }, dwellMs);
  }

  function goToRelativeSlide(step) {
    renderSlide(currentIndex + step);
    startAutoRotate();
  }

  prevBtn.addEventListener("click", () => {
    goToRelativeSlide(-1);
  });

  nextBtn.addEventListener("click", () => {
    goToRelativeSlide(1);
  });

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const nextIndex = Number(dot.getAttribute("data-testimonial-index"));
      if (!Number.isFinite(nextIndex)) {
        return;
      }
      renderSlide(nextIndex);
      startAutoRotate();
    });
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goToRelativeSlide(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goToRelativeSlide(1);
    }
  });

  root.addEventListener("focusin", stopAutoRotate);
  root.addEventListener("focusout", (event) => {
    if (root.contains(event.relatedTarget)) {
      return;
    }
    startAutoRotate();
  });

  renderSlide(0);
  startAutoRotate();
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
  const modalTitleEl = document.getElementById("bookingModalTitle");
  const continueBtn =
    document.getElementById("continueBookingBtn") ||
    document.getElementById("continueBtn");
  const checkAvailabilityBtn =
    document.getElementById("checkAvailabilityBtn") ||
    (form ? form.querySelector('button[type="submit"]') : null);
  const offerTitleEl = document.getElementById("availabilityOfferTitle");
  const offerCopyEl = document.getElementById("availabilityOfferCopy");
  const headerSubtitleEl = modal.querySelector(".lux-booking-header > p:last-child");
  const availabilitySuggestionsEl = document.createElement("section");
  availabilitySuggestionsEl.className = "lux-availability-suggestions";
  availabilitySuggestionsEl.hidden = true;
  if (form && form.parentNode) {
    form.insertAdjacentElement("afterend", availabilitySuggestionsEl);
  }

  if (!form || !destinationInput || !checkinInput || !checkoutInput || !guestsInput || !stepTwoEl || !continueBtn) {
    return;
  }

  const addonCheckboxes = Array.from(
    modal.querySelectorAll(".addon-checkbox")
  );

  const state = {
    isAvailable: false
  };
  const defaultTitle = modalTitleEl ? modalTitleEl.textContent : "Start Your Booking";
  const defaultSubtitle = headerSubtitleEl ? headerSubtitleEl.textContent : "";

  function setConfirmedLayout(enabled) {
    modal.classList.toggle("is-availability-confirmed", Boolean(enabled));
    if (modalTitleEl) {
      modalTitleEl.textContent = enabled ? "Your Stay Is Ready" : defaultTitle;
    }
    if (enabled) {
      modal.classList.remove("is-unavailable-suggested");
    }
  }

  function setUnavailableLayout(enabled) {
    modal.classList.toggle("is-unavailable-suggested", Boolean(enabled));
    if (enabled) {
      modal.classList.remove("is-availability-confirmed");
    }
    if (modalTitleEl) {
      modalTitleEl.textContent = enabled
        ? "Alternative Dates Available"
        : defaultTitle;
    }
    if (headerSubtitleEl) {
      headerSubtitleEl.textContent = enabled
        ? "Our apologies, these dates have already been booked. Please choose an available alternative below, or select your own new dates."
        : defaultSubtitle;
    }
  }

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
    const staySubtotal = pricing.nights * pricing.nightlyRate;

    const nightlyRateEl = document.getElementById("nightlyPriceDisplay");
    const nightsEl = document.getElementById("nightsCount");
    const staySubtotalEl = document.getElementById("staySubtotal");
    const addonsEl = document.getElementById("addonsTotal");
    const totalEl = document.getElementById("totalPrice");

    if (nightlyRateEl) {
      nightlyRateEl.textContent = formatCurrency(pricing.nightlyRate);
    }
    if (nightsEl) {
      nightsEl.textContent = String(pricing.nights);
    }
    if (staySubtotalEl) {
      staySubtotalEl.textContent = formatCurrency(staySubtotal);
    }
    if (addonsEl) {
      addonsEl.textContent = formatCurrency(pricing.addonsTotal);
    }
    if (totalEl) {
      totalEl.textContent = formatCurrency(pricing.total);
    }
  }

  function updateAvailabilityOfferCopy() {
    const pricing = getCurrentModalData();
    const destinationLabel = getDestinationLabel(pricing.destination) || "LuxHouse";
    if (offerTitleEl) {
      offerTitleEl.textContent = "Great news. Your selected dates are available.";
    }
    if (offerCopyEl) {
      offerCopyEl.textContent = `Your ${pricing.nights}-night stay at ${destinationLabel} starts at $${formatCurrency(pricing.nightlyRate)} per night. Select any enhancements below, then proceed to verification.`;
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
    setConfirmedLayout(false);
    setUnavailableLayout(false);
    stepTwoEl.hidden = true;
    continueBtn.disabled = true;
    setAvailabilityResult(availabilityResult, "", "");
    setStatusMessage(statusEl, "", "");
    clearSuggestions();
    addonCheckboxes.forEach((checkbox) => {
      checkbox.checked = false;
    });
    showDestinationAddons(destinationInput.value);
    syncPricingUI();
  }

  function openModal(prefill, options) {
    const modalOptions = options || {};
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

    if (modalOptions.availabilityConfirmed) {
      state.isAvailable = true;
      setConfirmedLayout(true);
      stepTwoEl.hidden = false;
      continueBtn.disabled = false;
      setAvailabilityResult(availabilityResult, "Available for your selected dates.", "success");
      clearSuggestions();
      setStatusMessage(
        statusEl,
        "Great news. Personalize your stay below, then proceed to verification.",
        "success"
      );
      updateAvailabilityOfferCopy();
      return;
    }

    if (modalOptions.autoCheck) {
      setTimeout(() => {
        form.requestSubmit();
      }, 0);
    }
  }

  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  function clearSuggestions(resetUnavailableLayout = true) {
    availabilitySuggestionsEl.hidden = true;
    availabilitySuggestionsEl.innerHTML = "";
    if (resetUnavailableLayout && modal.classList.contains("is-unavailable-suggested")) {
      setUnavailableLayout(false);
    }
  }

  async function findAlternativeDateOptions(destination, checkin, nights, limit) {
    const normalizedDestination = normalizeDestination(destination);
    const normalizedNights = Number.isFinite(nights) && nights > 0 ? nights : 1;
    const maxOptions = Number.isFinite(limit) && limit > 0 ? Math.round(limit) : 3;
    const maxSearchDays = 120;
    const options = [];

    for (let dayOffset = 1; dayOffset <= maxSearchDays && options.length < maxOptions; dayOffset += 1) {
      const suggestedCheckin = addDays(checkin, dayOffset);
      const suggestedCheckout = addDays(suggestedCheckin, normalizedNights);
      try {
        const data = await postJson("/availability", {
          destination: normalizedDestination,
          checkin: suggestedCheckin,
          checkout: suggestedCheckout
        });
        if (data && data.available === true) {
          options.push({
            checkin: suggestedCheckin,
            checkout: suggestedCheckout,
            nights: normalizedNights
          });
        }
      } catch (error) {
        console.error("Alternative date lookup failed:", error);
      }
    }

    return options;
  }

  async function showAlternativeSuggestions(modalData) {
    clearSuggestions(false);
    const destinationLabel = getDestinationLabel(modalData.destination) || "this destination";
    const nightsText = modalData.nights === 1 ? "night" : "nights";

    availabilitySuggestionsEl.hidden = false;
    availabilitySuggestionsEl.innerHTML = `
      <p class="lux-availability-suggestions-title">Our apologies, these dates have already been booked.</p>
      <p class="lux-availability-suggestions-subtitle">Searching for nearby ${modalData.nights} ${nightsText} options at ${destinationLabel}.</p>
    `;

    const options = await findAlternativeDateOptions(
      modalData.destination,
      modalData.checkin,
      modalData.nights,
      4
    );

    if (!options.length) {
      availabilitySuggestionsEl.innerHTML = `
        <p class="lux-availability-suggestions-title">No nearby options found yet.</p>
        <p class="lux-availability-suggestions-subtitle">Try adjusting your check-in date or stay length, then check again.</p>
      `;
      return;
    }

    const buttonsMarkup = options
      .map((option, index) => {
        const optionNightsText = option.nights === 1 ? "night" : "nights";
        return `<button type="button" class="lux-suggestion-btn" data-suggest-checkin="${option.checkin}" data-suggest-checkout="${option.checkout}">
          Option ${index + 1}: ${formatShortDate(option.checkin)} - ${formatShortDate(option.checkout)} (${option.nights} ${optionNightsText})
        </button>`;
      })
      .join("");

    availabilitySuggestionsEl.innerHTML = `
      <p class="lux-availability-suggestions-title">Available alternatives for your selected stay:</p>
      <div class="lux-availability-suggestions-actions">${buttonsMarkup}</div>
      <button type="button" class="lux-suggestion-custom-btn">Choose Your Own New Dates</button>
    `;

    const suggestionButtons = availabilitySuggestionsEl.querySelectorAll(".lux-suggestion-btn");
    suggestionButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const suggestedCheckin = button.getAttribute("data-suggest-checkin") || "";
        const suggestedCheckout = button.getAttribute("data-suggest-checkout") || "";
        if (!suggestedCheckin || !suggestedCheckout) {
          return;
        }
        checkinInput.value = suggestedCheckin;
        checkoutInput.value = suggestedCheckout;
        clearSuggestions();
        form.requestSubmit();
      });
    });

    const customDateButton = availabilitySuggestionsEl.querySelector(".lux-suggestion-custom-btn");
    if (customDateButton) {
      customDateButton.addEventListener("click", () => {
        setUnavailableLayout(false);
        clearSuggestions();
        setAvailabilityResult(availabilityResult, "", "");
        setStatusMessage(statusEl, "Choose your preferred dates and check availability again.", "");
      });
    }
  }

  async function handleAvailabilityCheck(event) {
    event.preventDefault();
    const modalData = getCurrentModalData();
    const validationMessage = validateStayInputs(modalData);

    if (validationMessage) {
      state.isAvailable = false;
      setConfirmedLayout(false);
      setUnavailableLayout(false);
      stepTwoEl.hidden = true;
      continueBtn.disabled = true;
      clearSuggestions();
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
        destination: modalData.destination,
        checkin: modalData.checkin,
        checkout: modalData.checkout
      });

      const available = data.available === true;
      state.isAvailable = available;

      if (available) {
        setConfirmedLayout(true);
        setUnavailableLayout(false);
        stepTwoEl.hidden = false;
        continueBtn.disabled = false;
        clearSuggestions();
        showDestinationAddons(modalData.destination);
        syncPricingUI();
        setAvailabilityResult(availabilityResult, "Great news. Your dates are available.", "success");
        setStatusMessage(
          statusEl,
          "Review your pricing, add any enhancements, and proceed when ready.",
          "success"
        );
        updateAvailabilityOfferCopy();
      } else {
        setConfirmedLayout(false);
        setUnavailableLayout(true);
        stepTwoEl.hidden = true;
        continueBtn.disabled = true;
        setAvailabilityResult(availabilityResult, "", "");
        setStatusMessage(statusEl, "", "");
        await showAlternativeSuggestions(modalData);
      }
    } catch (error) {
      state.isAvailable = false;
      setConfirmedLayout(false);
      setUnavailableLayout(false);
      stepTwoEl.hidden = true;
      continueBtn.disabled = true;
      clearSuggestions();
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
    const bookingStatusUrl = new URL("booking-status.html", window.location.href);
    bookingStatusUrl.searchParams.set("requestId", requestId);

    let verificationWindow = null;
    try {
      verificationWindow = window.open("", "luxhouseIdentityVerification");
    } catch (_) {
      verificationWindow = null;
    }

    const canUseVerificationWindow =
      Boolean(verificationWindow) && Boolean(!verificationWindow.closed);
    if (canUseVerificationWindow) {
      try {
        verificationWindow.document.title = "Opening verification...";
        verificationWindow.document.body.style.fontFamily = "system-ui, -apple-system, Segoe UI, sans-serif";
        verificationWindow.document.body.style.margin = "0";
        verificationWindow.document.body.style.padding = "18px";
        verificationWindow.document.body.textContent = "Opening secure Stripe verification...";
        verificationWindow.focus();
      } catch (_) {
        // Ignore cross-window document access issues.
      }
    }

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
        returnUrl: new URL("booking-status.html", window.location.href).toString()
      });

      if (verificationData.url) {
        if (canUseVerificationWindow) {
          verificationWindow.location.replace(verificationData.url);
          window.location.assign(bookingStatusUrl.toString());
          return;
        }

        window.location.assign(verificationData.url);
        return;
      }

      window.location.assign(bookingStatusUrl.toString());
    } catch (error) {
      let userMessage = error.message || "Could not start verification. Please try again.";
      if (error && error.code === "identity_session_create_failed") {
        const stripeReqId =
          error &&
          error.debug &&
          typeof error.debug.stripeRequestId === "string" &&
          error.debug.stripeRequestId.trim()
            ? error.debug.stripeRequestId.trim()
            : "";
        const flowMayBeRequired =
          Boolean(error && error.debug && error.debug.flowMayBeRequired);
        userMessage = flowMayBeRequired
          ? "We could not launch identity verification because the LuxHouse Stripe account requires a configured Verification Flow. Please contact support."
          : "We could not launch identity verification right now. Please contact support to confirm Stripe Identity is active on the LuxHouse account.";
        if (stripeReqId) {
          userMessage += ` Reference: ${stripeReqId}`;
        }
      }
      setStatusMessage(
        statusEl,
        userMessage,
        "error"
      );
      if (canUseVerificationWindow && verificationWindow && !verificationWindow.closed) {
        try {
          verificationWindow.close();
        } catch (_) {
          // Ignore close-window errors.
        }
      }
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
    setUnavailableLayout(false);
    stepTwoEl.hidden = true;
    continueBtn.disabled = true;
    showDestinationAddons(destinationInput.value);
    setAvailabilityResult(availabilityResult, "", "");
    clearSuggestions();
    setStatusMessage(statusEl, "", "");
  });

  checkinInput.addEventListener("change", () => {
    state.isAvailable = false;
    setUnavailableLayout(false);
    stepTwoEl.hidden = true;
    continueBtn.disabled = true;
    enforceDateOrder(checkinInput, checkoutInput);
    syncPricingUI();
    setAvailabilityResult(availabilityResult, "", "");
    clearSuggestions();
    setStatusMessage(statusEl, "", "");
  });

  checkoutInput.addEventListener("change", () => {
    state.isAvailable = false;
    setUnavailableLayout(false);
    stepTwoEl.hidden = true;
    continueBtn.disabled = true;
    syncPricingUI();
    setAvailabilityResult(availabilityResult, "", "");
    clearSuggestions();
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

function initCactusBedroomLightbox() {
  const triggers = Array.from(
    document.querySelectorAll(".lux-cactus-category-item[data-bedroom-gallery]")
  );
  const lightbox = document.getElementById("cactusLightbox");
  const imageEl = document.getElementById("cactusLightboxImage");
  const prevBtn = document.getElementById("cactusPrevBtn");
  const nextBtn = document.getElementById("cactusNextBtn");
  const thumbStrip = document.getElementById("cactusThumbStrip");

  if (!triggers.length || !lightbox || !imageEl || !prevBtn || !nextBtn || !thumbStrip) {
    return;
  }

  let activeIndex = 0;
  let activeSources = [];
  let activeAlts = [];
  let activeLabel = "Bedroom";
  let thumbButtons = [];

  function buildFallbackLabel(rawToken) {
    const cleaned = String(rawToken || "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) {
      return "Bedroom";
    }
    return cleaned
      .split(" ")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function getAlt(index) {
    if (activeAlts[index]) {
      return activeAlts[index];
    }
    return `${activeLabel} photo ${index + 1}`;
  }

  function renderImage() {
    if (!activeSources.length) {
      return;
    }
    imageEl.src = activeSources[activeIndex];
    imageEl.alt = getAlt(activeIndex);
    thumbButtons.forEach((button, index) => {
      const isActive = index === activeIndex;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-current", isActive ? "true" : "false");
    });
  }

  function showIndex(index) {
    if (!activeSources.length) {
      return;
    }
    activeIndex = (index + activeSources.length) % activeSources.length;
    renderImage();
  }

  function openLightbox() {
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
  }

  function closeLightbox() {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
  }

  function renderThumbs() {
    thumbButtons = [];
    thumbStrip.innerHTML = "";

    activeSources.forEach((source, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lux-cactus-thumb";
      button.setAttribute("aria-label", `Show ${activeLabel} photo ${index + 1}`);

      const thumbImage = document.createElement("img");
      thumbImage.src = source;
      thumbImage.alt = getAlt(index);
      thumbImage.onerror = () => {
        thumbImage.onerror = null;
        thumbImage.src = "assets/images/placeholders/placeholder-800x600.svg";
      };

      button.appendChild(thumbImage);
      button.addEventListener("click", () => {
        showIndex(index);
      });

      thumbStrip.appendChild(button);
      thumbButtons.push(button);
    });
  }

  function openGallery(trigger, startIndex = 0) {
    const sources = (trigger.getAttribute("data-bedroom-gallery-images") || "")
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!sources.length) {
      return;
    }

    activeSources = sources;
    activeAlts = (trigger.getAttribute("data-bedroom-gallery-alts") || "")
      .split("|")
      .map((value) => value.trim());
    activeLabel =
      trigger.getAttribute("data-bedroom-gallery-label") ||
      buildFallbackLabel(trigger.getAttribute("data-bedroom-gallery"));

    activeIndex = 0;
    renderThumbs();
    openLightbox();
    showIndex(startIndex);
  }

  imageEl.onerror = () => {
    imageEl.onerror = null;
    imageEl.src = "assets/images/placeholders/placeholder-800x600.svg";
  };

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", () => {
      openGallery(trigger, 0);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openGallery(trigger, 0);
      }
    });
  });

  prevBtn.addEventListener("click", () => {
    showIndex(activeIndex - 1);
  });
  nextBtn.addEventListener("click", () => {
    showIndex(activeIndex + 1);
  });

  lightbox.querySelectorAll("[data-cactus-close-lightbox]").forEach((element) => {
    element.addEventListener("click", closeLightbox);
  });

  document.addEventListener("keydown", (event) => {
    if (!lightbox.classList.contains("is-open")) {
      return;
    }
    if (event.key === "Escape") {
      closeLightbox();
    }
    if (event.key === "ArrowLeft") {
      showIndex(activeIndex - 1);
    }
    if (event.key === "ArrowRight") {
      showIndex(activeIndex + 1);
    }
  });
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
          destination: item.destination,
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
            bookingModalController.open(payload, { availabilityConfirmed: true });
          }
        } else {
          setAvailabilityResult(resultEl, "These dates were just booked. Opening alternatives...", "error");
          if (bookingModalController && bookingModalController.open) {
            bookingModalController.open(payload, { autoCheck: true });
          }
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
  let identityAccessConfirmed = false;

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

  function buildVerificationStatusUrl() {
    const statusUrl = new URL("booking-status.html", window.location.href);
    statusUrl.searchParams.set("requestId", requestId);
    if (normalizedDestination) {
      statusUrl.searchParams.set("destination", normalizedDestination);
    }
    if (checkin && checkin !== "-") {
      statusUrl.searchParams.set("checkin", checkin);
    }
    if (checkout && checkout !== "-") {
      statusUrl.searchParams.set("checkout", checkout);
    }
    if (guests && guests !== "-") {
      statusUrl.searchParams.set("guests", String(guests));
    }
    return statusUrl;
  }

  async function confirmIdentityAccess() {
    submitRequestBtn.disabled = true;
    setRequestStatus("Confirming identity verification before booking...", "");

    try {
      const response = await fetch(
        `${API_BASE_URL}/booking-status?requestId=${encodeURIComponent(requestId)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" }
        }
      );
      const data = await response.json().catch(() => ({}));
      const status = String(data.status || "").trim().toLowerCase();
      if (response.ok && (status === "verified" || status === "approved")) {
        identityAccessConfirmed = true;
        submitRequestBtn.disabled = false;
        setRequestStatus("", "");
        return;
      }
    } catch (error) {
      console.error("Booking page identity gate failed:", error);
    }

    setRequestStatus(
      "Identity verification is not confirmed yet. Returning to booking status.",
      "error"
    );
    window.setTimeout(() => {
      window.location.replace(buildVerificationStatusUrl().toString());
    }, 600);
  }

  confirmIdentityAccess();

  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!identityAccessConfirmed) {
      setRequestStatus("Identity verification must be confirmed before booking.", "error");
      return;
    }

    const guestName = nameInput.value.trim();
    const guestEmail = emailInput.value.trim();
    const guestPhone = phoneInput.value.trim();
    const notes = notesInput ? notesInput.value.trim() : "";

    if (!guestName || !guestEmail || !guestPhone) {
      setRequestStatus("Please complete your name, email, and phone number.", "error");
      return;
    }
    if (!isDestinationEnabled(normalizedDestination)) {
      setRequestStatus(PINE_COMING_SOON_MESSAGE, "error");
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

  maskPineContentUntilLaunch();
  initFeaturedDestinationImageRotator();
  initHeroBookingBar();
  initDestinationCarousel();
  initEditorialTestimonials();
  initCactusBedroomLightbox();
  initBookingModal();
  initPropertyForms();
  initBookingSummaryPage();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
