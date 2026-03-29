const menuToggle = document.querySelector(".menu-toggle");
const navLinks = document.querySelector(".nav-links");
const inquiryButton = document.getElementById("inquiryButton");
const tabs = document.querySelectorAll(".tab");

const bookingForm = document.getElementById("bookingForm");
const destinationSelect = document.getElementById("destinationSelect");
const checkInDate = document.getElementById("checkInDate");
const checkOutDate = document.getElementById("checkOutDate");
const guestCount = document.getElementById("guestCount");
const increaseGuests = document.getElementById("increaseGuests");
const decreaseGuests = document.getElementById("decreaseGuests");
const bookingFeedback = document.getElementById("bookingFeedback");

const bookingModal = document.getElementById("bookingModal");
const bookingModalForm = document.getElementById("bookingModalForm");
const bookingStatus = document.getElementById("bookingStatus");
const bookingStepTwo = document.getElementById("bookingStepTwo");
const continueBookingBtn = document.getElementById("continueBookingBtn");
const bookingMessage = document.getElementById("bookingMessage");
const modalDestination = document.getElementById("modalDestination");
const modalCheckin = document.getElementById("modalCheckin");
const modalCheckout = document.getElementById("modalCheckout");
const modalGuests = document.getElementById("modalGuests");

const blockedDateRange = {
  start: "2026-04-10",
  end: "2026-04-15"
};

const collectionData = {
  fan: {
    image: "assets/images/placeholders/placeholder-800x600.svg",
    kicker: "Most booked this season",
    title: "Fan Favorites",
    text: "Guest-loved homes with standout layouts, elevated amenities, and signature LuxHouse hosting details."
  },
  new: {
    image: "assets/images/placeholders/placeholder-800x600.svg",
    kicker: "Freshly launched",
    title: "New Homes",
    text: "Recently added stays with updated interiors, thoughtful extras, and destination-first design."
  },
  group: {
    image: "assets/images/placeholders/placeholder-800x600.svg",
    kicker: "Built for gatherings",
    title: "Group Estates",
    text: "Large-format homes designed for reunions, retreats, and milestone weekends with room to spread out."
  }
};

const destinationLabels = {
  "cactus-and-chill": "Cactus and Chill - Mesa, Arizona",
  "pine-and-peace": "Pine and Peace - Carnelian Bay, Lake Tahoe",
  "sunstone-social": "Sunstone Social - Scottsdale, Arizona"
};

const modalDestinationLabels = {
  cactus: "Cactus & Chill House",
  pine: "Pine & Peace House",
  third: "Third Property"
};

let modalAvailabilityReady = false;

function datesOverlap(startA, endA, startB, endB) {
  const aStart = new Date(startA);
  const aEnd = new Date(endA);
  const bStart = new Date(startB);
  const bEnd = new Date(endB);
  return aStart <= bEnd && bStart <= aEnd;
}

function openBookingModal() {
  if (!bookingModal) {
    return;
  }

  modalAvailabilityReady = false;
  if (bookingModalForm) {
    bookingModalForm.reset();
  }
  if (modalGuests) {
    modalGuests.value = "6";
  }
  if (bookingMessage) {
    bookingMessage.value = "";
  }
  if (bookingStatus) {
    bookingStatus.textContent = "";
    bookingStatus.classList.remove("is-error", "is-success");
  }
  if (bookingStepTwo) {
    bookingStepTwo.hidden = true;
  }
  if (continueBookingBtn) {
    continueBookingBtn.disabled = true;
  }

  bookingModal.classList.add("is-open");
  bookingModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeBookingModal() {
  if (!bookingModal) {
    return;
  }

  bookingModal.classList.remove("is-open");
  bookingModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function setBookingStatus(message, type) {
  if (!bookingStatus) {
    return;
  }

  bookingStatus.textContent = message;
  bookingStatus.classList.remove("is-error", "is-success");

  if (type === "error") {
    bookingStatus.classList.add("is-error");
  }

  if (type === "success") {
    bookingStatus.classList.add("is-success");
  }
}

function checkAvailability(event) {
  if (event) {
    event.preventDefault();
  }

  if (!bookingModalForm || !modalDestination || !modalCheckin || !modalCheckout || !modalGuests || !continueBookingBtn || !bookingStepTwo) {
    return;
  }

  const destination = modalDestination.value;
  const checkin = modalCheckin.value;
  const checkout = modalCheckout.value;
  const guests = Number(modalGuests.value);

  modalAvailabilityReady = false;
  continueBookingBtn.disabled = true;
  bookingStepTwo.hidden = true;

  if (!destination || !checkin || !checkout || !guests) {
    setBookingStatus("Please complete all required fields before checking availability.", "error");
    return;
  }

  if (new Date(checkout) <= new Date(checkin)) {
    setBookingStatus("Check-out must be later than check-in.", "error");
    return;
  }

  const unavailable = datesOverlap(checkin, checkout, blockedDateRange.start, blockedDateRange.end);

  if (unavailable) {
    setBookingStatus("These dates are not available. Please try different dates.", "error");
    return;
  }

  modalAvailabilityReady = true;
  continueBookingBtn.disabled = false;
  bookingStepTwo.hidden = false;
  setBookingStatus("Great news - your dates are available.", "success");
}

function handleBookingRedirect() {
  if (!modalAvailabilityReady || !modalDestination || !modalCheckin || !modalCheckout || !modalGuests) {
    return;
  }

  const params = new URLSearchParams({
    destination: modalDestination.value,
    checkin: modalCheckin.value,
    checkout: modalCheckout.value,
    guests: modalGuests.value,
    message: bookingMessage ? bookingMessage.value.trim() : ""
  });

  window.location.href = `booking.html?${params.toString()}`;
}

function handlePayment() {
  // Integrate Stripe Checkout or PaymentIntent here.
  // Use booking details and amount data from the backend when available.
  window.alert("Stripe integration placeholder: Integrate Stripe Checkout or PaymentIntent here.");
}

function initBookingModalEvents() {
  if (!bookingModal) {
    return;
  }

  document.querySelectorAll("[data-open-booking-modal]").forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      openBookingModal();
    });
  });

  document.querySelectorAll("[data-close-booking-modal]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      closeBookingModal();
    });
  });

  if (bookingModalForm) {
    bookingModalForm.addEventListener("submit", checkAvailability);
  }

  if (continueBookingBtn) {
    continueBookingBtn.addEventListener("click", handleBookingRedirect);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && bookingModal.classList.contains("is-open")) {
      closeBookingModal();
    }
  });
}

function initBookingPageSummary() {
  const summaryDestination = document.getElementById("summaryDestination");
  const summaryCheckin = document.getElementById("summaryCheckin");
  const summaryCheckout = document.getElementById("summaryCheckout");
  const summaryGuests = document.getElementById("summaryGuests");

  if (!summaryDestination || !summaryCheckin || !summaryCheckout || !summaryGuests) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const destinationKey = params.get("destination") || "";
  const destination = modalDestinationLabels[destinationKey] || destinationKey || "Not selected";

  summaryDestination.textContent = destination;
  summaryCheckin.textContent = params.get("checkin") || "Not selected";
  summaryCheckout.textContent = params.get("checkout") || "Not selected";
  summaryGuests.textContent = params.get("guests") ? `${params.get("guests")} guests` : "Not selected";

  const proceedBtn = document.getElementById("proceedToPaymentBtn");
  const paymentSection = document.getElementById("paymentSection");
  const payConfirmBtn = document.getElementById("payConfirmBtn");

  if (proceedBtn && paymentSection) {
    proceedBtn.addEventListener("click", () => {
      paymentSection.hidden = false;
      paymentSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (payConfirmBtn) {
    payConfirmBtn.addEventListener("click", handlePayment);
  }
}

if (menuToggle && navLinks) {
  menuToggle.addEventListener("click", () => {
    const expanded = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!expanded));
    navLinks.classList.toggle("open");
  });
}

if (increaseGuests && decreaseGuests && guestCount) {
  increaseGuests.addEventListener("click", () => {
    const value = Number(guestCount.value);
    guestCount.value = String(Math.min(20, value + 1));
  });

  decreaseGuests.addEventListener("click", () => {
    const value = Number(guestCount.value);
    guestCount.value = String(Math.max(1, value - 1));
  });
}

if (bookingForm && destinationSelect && checkInDate && checkOutDate && bookingFeedback && guestCount) {
  bookingForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const destination = destinationSelect.value;
    const checkIn = checkInDate.value;
    const checkOut = checkOutDate.value;

    if (!destination || !checkIn || !checkOut) {
      bookingFeedback.textContent = "Please select destination, check-in, and check-out before continuing.";
      return;
    }

    const checkInTime = new Date(checkIn);
    const checkOutTime = new Date(checkOut);

    if (checkOutTime <= checkInTime) {
      bookingFeedback.textContent = "Check-out must be after check-in.";
      return;
    }

    const label = destinationLabels[destination] || "your selected destination";
    bookingFeedback.textContent = `Great choice. ${guestCount.value} guests for ${label}. Dates saved from ${checkIn} to ${checkOut}.`;
  });
}

if (tabs.length) {
  const imageEl = document.getElementById("collectionImage");
  const kickerEl = document.getElementById("collectionKicker");
  const titleEl = document.getElementById("collectionTitle");
  const textEl = document.getElementById("collectionText");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((button) => button.classList.remove("is-active"));
      tab.classList.add("is-active");

      const key = tab.getAttribute("data-tab");
      const item = key ? collectionData[key] : null;

      if (!item || !imageEl || !kickerEl || !titleEl || !textEl) {
        return;
      }

      imageEl.src = item.image;
      kickerEl.textContent = item.kicker;
      titleEl.textContent = item.title;
      textEl.textContent = item.text;
    });
  });
}

if (inquiryButton) {
  inquiryButton.addEventListener("click", () => {
    openBookingModal();
  });
}

initBookingModalEvents();
initBookingPageSummary();

window.openBookingModal = openBookingModal;
window.closeBookingModal = closeBookingModal;
window.checkAvailability = checkAvailability;
window.handleBookingRedirect = handleBookingRedirect;
window.handlePayment = handlePayment;
