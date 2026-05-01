// =========================================================
// LuxHouse Prototype - Core Interactions
// =========================================================

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

// =========================================================
// Booking Modal Elements
// =========================================================

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
const addonsGroups = document.querySelectorAll(".addons-group");
const addonCheckboxes = document.querySelectorAll(".addon-checkbox");
const nightlyPriceDisplayEl = document.getElementById("nightlyPriceDisplay");
const nightsCountEl = document.getElementById("nightsCount");
const addonsTotalEl = document.getElementById("addonsTotal");
const totalPriceEl = document.getElementById("totalPrice");
const AVAILABILITY_API_URL = "https://restless-waterfall-a71b.tech-e7b.workers.dev";
const VERIFY_API_URL = "https://restless-waterfall-a71b.tech-e7b.workers.dev/verify";
const NOT_AVAILABLE_MESSAGE = "Not available for selected dates";
const GENERIC_BOOKING_ERROR_MESSAGE = "Something went wrong. Please try again.";
const MODAL_AVAILABLE_BUTTON_LABEL = "✔ Available — Continue";

const blockedDateRange = {
  start: "2026-04-10",
  end: "2026-04-15"
};

const cactusCollectionImages = [...new Set([
  "assets/images/cactus/Firepit%20Closeup.png",
  "assets/images/cactus/Living%20Room%20Closeup.png",
  "assets/images/cactus/Kitchen%20Vibrant.png",
  "assets/images/cactus/Primary%20Bedroom.jpg",
  "assets/images/cactus/Primary%20Bathroom%20Vibrant.png",
  "assets/images/cactus/Firepit%20Seating.png"
])];

const collectionData = {
  fan: {
    images: cactusCollectionImages,
    image: cactusCollectionImages[0],
    kicker: "Most booked this season",
    title: "Fan Favorites",
    text: "Guest-loved homes with standout layouts, elevated amenities, and signature LuxHouse hosting details."
  },
  new: {
    images: cactusCollectionImages,
    image: cactusCollectionImages[1],
    kicker: "Freshly launched",
    title: "New Homes",
    text: "Recently added stays with updated interiors, thoughtful extras, and destination-first design."
  },
  group: {
    images: cactusCollectionImages,
    image: cactusCollectionImages[2],
    kicker: "Built for gatherings",
    title: "Group Estates",
    text: "Large-format homes designed for reunions, retreats, and milestone weekends with room to spread out."
  }
};

const destinationLabels = {
  "cactus-and-chill": "Cactus and Chill - Mesa, Arizona",
  "pine-and-peace": "Pine and Peace - Carnelian Bay, Lake Tahoe"
};

const modalDestinationLabels = {
  cactus: "Cactus & Chill House",
  pine: "Pine & Peace House"
};

const supportedProperties = ["cactus", "pine"];
const nightlyRates = {
  cactus: 450,
  pine: 495
};

let modalAvailabilityReady = false;
let activeAvailabilityForm = null;

// =========================================================
// Utility
// =========================================================

function datesOverlap(startA, endA, startB, endB) {
  const aStart = new Date(startA);
  const aEnd = new Date(endA);
  const bStart = new Date(startB);
  const bEnd = new Date(endB);
  return aStart <= bEnd && bStart <= aEnd;
}

function imageSourceFromCactus(fileName) {
  return `assets/images/cactus/${fileName.replace(/ /g, "%20")}`;
}

function makeImageLabel(fileName) {
  return fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").trim();
}

function setAvailabilityFeedback(target, message, state = "") {
  if (!target) {
    return;
  }
  target.textContent = message;
  target.className = `availability-result${state ? ` ${state}` : ""}`;
}

function getAvailabilityResultForForm(sourceForm) {
  if (!sourceForm) {
    return null;
  }

  let availabilityResult = sourceForm.querySelector("#availabilityResult");
  if (availabilityResult) {
    return availabilityResult;
  }

  const actionButton = sourceForm.querySelector("button[type=\"submit\"]");
  if (!actionButton) {
    return null;
  }

  availabilityResult = document.createElement("div");
  availabilityResult.id = "availabilityResult";
  availabilityResult.className = "availability-result";
  actionButton.insertAdjacentElement("afterend", availabilityResult);
  return availabilityResult;
}

function getModalCheckAvailabilityButton() {
  if (!bookingModalForm) {
    return null;
  }
  return bookingModalForm.querySelector("#modalCheckAvailabilityBtn")
    || bookingModalForm.querySelector("button[type=\"submit\"]");
}

function resetModalAvailabilityState() {
  modalAvailabilityReady = false;

  if (continueBookingBtn) {
    continueBookingBtn.disabled = true;
  }
  if (bookingStepTwo) {
    bookingStepTwo.hidden = true;
  }

  const modalCheckAvailabilityBtn = getModalCheckAvailabilityButton();
  if (modalCheckAvailabilityBtn) {
    modalCheckAvailabilityBtn.disabled = false;
    modalCheckAvailabilityBtn.innerText = "Check Availability";
  }

  if (bookingModalForm) {
    const availabilityResult = bookingModalForm.querySelector("#availabilityResult");
    if (availabilityResult) {
      setAvailabilityFeedback(availabilityResult, "", "");
    }
  }
}

function setInlineFormError(form, message) {
  if (!form) {
    return;
  }

  let status = form.querySelector(".availability-result");
  if (!status) {
    status = document.createElement("div");
    status.className = "availability-result";
    const submitButton = form.querySelector("button[type=\"submit\"]");
    if (submitButton) {
      submitButton.insertAdjacentElement("afterend", status);
    } else {
      form.appendChild(status);
    }
  }

  setAvailabilityFeedback(status, message, message ? "error" : "");
}

async function startIdentityVerification(actionButton, onError) {
  const previousLabel = actionButton ? actionButton.innerText : "";

  if (actionButton) {
    actionButton.disabled = true;
    actionButton.innerText = "Redirecting...";
  }

  try {
    const response = await fetch(VERIFY_API_URL, {
      method: "POST"
    });

    if (!response.ok) {
      throw new Error(`Verify API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data || typeof data.url !== "string" || !data.url) {
      throw new Error("Verify API did not return a valid URL.");
    }

    window.location.href = data.url;
  } catch (error) {
    console.error(error);
    if (typeof onError === "function") {
      onError(GENERIC_BOOKING_ERROR_MESSAGE);
    }
    if (actionButton) {
      actionButton.disabled = false;
      actionButton.innerText = previousLabel;
    }
  }
}

// =========================================================
// Booking Modal API
// =========================================================

function openBookingModal(preselectedDestination = "") {
  if (!bookingModal) {
    return;
  }

  if (bookingModalForm) {
    bookingModalForm.reset();
  }
  if (modalGuests) {
    modalGuests.value = "6";
  }
  if (bookingMessage) {
    bookingMessage.value = "";
  }
  if (modalDestination && preselectedDestination) {
    modalDestination.value = preselectedDestination;
  }
  if (bookingStatus) {
    bookingStatus.textContent = "";
    bookingStatus.classList.remove("is-error", "is-success");
  }
  resetModalAvailabilityState();
  syncAddonsGroupVisibility();

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

function getActiveAddonsGroup() {
  if (!modalDestination) {
    return null;
  }
  return document.querySelector(`.addons-group[data-property="${modalDestination.value}"]`);
}

function calculateNights() {
  if (!modalCheckin || !modalCheckout || !modalCheckin.value || !modalCheckout.value) {
    return 0;
  }

  const checkinDate = new Date(modalCheckin.value);
  const checkoutDate = new Date(modalCheckout.value);
  const msDiff = checkoutDate - checkinDate;
  const nights = Math.floor(msDiff / (1000 * 60 * 60 * 24));

  if (!Number.isFinite(nights) || nights <= 0) {
    return 0;
  }

  return nights;
}

function calculateAddons() {
  const activeGroup = getActiveAddonsGroup();
  if (!activeGroup) {
    return 0;
  }

  return Array.from(activeGroup.querySelectorAll(".addon-checkbox:checked"))
    .reduce((sum, checkbox) => sum + Number(checkbox.getAttribute("data-price") || 0), 0);
}

function updateTotal() {
  const destination = modalDestination ? modalDestination.value : "";
  const nightly = destination && nightlyRates[destination] ? nightlyRates[destination] : 0;
  const nights = calculateNights();
  const addons = calculateAddons();
  const total = (nightly * nights) + addons;

  if (nightlyPriceDisplayEl) {
    nightlyPriceDisplayEl.textContent = String(nightly);
  }
  if (nightsCountEl) {
    nightsCountEl.textContent = String(nights);
  }
  if (addonsTotalEl) {
    addonsTotalEl.textContent = String(addons);
  }
  if (totalPriceEl) {
    totalPriceEl.textContent = String(total);
  }
}

function syncAddonsGroupVisibility() {
  addonsGroups.forEach((group) => {
    const isActive = modalDestination && group.getAttribute("data-property") === modalDestination.value;
    group.hidden = !isActive;

    if (!isActive) {
      group.querySelectorAll(".addon-checkbox").forEach((checkbox) => {
        checkbox.checked = false;
      });
    }
  });

  updateTotal();
}

async function checkAvailability() {

  const scopedForm = activeAvailabilityForm;
  const checkinInput = scopedForm
    ? scopedForm.querySelector('[name="checkin"]')
    : document.querySelector('[name="checkin"]');
  const checkoutInput = scopedForm
    ? scopedForm.querySelector('[name="checkout"]')
    : document.querySelector('[name="checkout"]');
  const checkin = checkinInput ? checkinInput.value : "";
  const checkout = checkoutInput ? checkoutInput.value : "";

  console.log("Sending:", { checkin, checkout });

  const res = await fetch("https://restless-waterfall-a71b.tech-e7b.workers.dev/availability", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      checkin,
      checkout
    })
  });

  const data = await res.json();

  console.log("Response:", data);

  const resultBox = scopedForm
    ? (scopedForm.querySelector("#availabilityResult") || getAvailabilityResultForForm(scopedForm))
    : document.getElementById("availabilityResult");
  const continueBtn = document.getElementById("continueBtn");

  if (!resultBox || !continueBtn) {
    return;
  }

  if (data.available) {
    resultBox.innerText = "Available for your dates";
    resultBox.style.color = "green";

    // enable continue button
    continueBtn.disabled = false;
    modalAvailabilityReady = true;
    if (bookingStepTwo) {
      bookingStepTwo.hidden = false;
    }

  } else {
    resultBox.innerText = "Not available for selected dates";
    resultBox.style.color = "red";

    // disable continue button
    continueBtn.disabled = true;
    modalAvailabilityReady = false;
    if (bookingStepTwo) {
      bookingStepTwo.hidden = true;
    }
  }
}

function handleCheckAvailability(event) {
  if (event) {
    event.preventDefault();
  }
  activeAvailabilityForm = event && event.currentTarget instanceof HTMLElement
    ? event.currentTarget.closest("form")
    : null;
  checkAvailability().catch((err) => {
    console.error("Availability error:", err);
    const resultBox = document.getElementById("availabilityResult");
    if (resultBox) {
      resultBox.innerText = GENERIC_BOOKING_ERROR_MESSAGE;
      resultBox.style.color = "red";
    }
    const continueBtn = document.getElementById("continueBtn");
    if (continueBtn) {
      continueBtn.disabled = true;
    }
    modalAvailabilityReady = false;
    if (bookingStepTwo) {
      bookingStepTwo.hidden = true;
    }
  });
}

function handlePayment() {
  const payConfirmBtn = document.getElementById("payConfirmBtn");
  const paymentSection = document.getElementById("paymentSection");
  let paymentStatus = document.getElementById("paymentStatus");

  if (!paymentStatus && paymentSection) {
    paymentStatus = document.createElement("p");
    paymentStatus.id = "paymentStatus";
    paymentStatus.className = "lux-booking-status";
    paymentSection.appendChild(paymentStatus);
  }

  if (paymentStatus) {
    paymentStatus.textContent = "";
    paymentStatus.classList.remove("is-error", "is-success");
  }

  startIdentityVerification(payConfirmBtn, (message) => {
    if (!paymentStatus) {
      return;
    }
    paymentStatus.textContent = message;
    paymentStatus.classList.remove("is-success");
    paymentStatus.classList.add("is-error");
  });
}

function initBookingModalEvents() {
  if (!bookingModal) {
    return;
  }

  document.querySelectorAll("[data-open-booking-modal]").forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      const preselected = trigger.getAttribute("data-booking-destination") || "";
      openBookingModal(preselected);
    });
  });

  document.querySelectorAll("[data-close-booking-modal]").forEach((trigger) => {
    trigger.addEventListener("click", closeBookingModal);
  });

  if (bookingModalForm) {
    const modalCheckAvailabilityBtn = bookingModalForm.querySelector("button[type=\"submit\"]");
    if (modalCheckAvailabilityBtn) {
      modalCheckAvailabilityBtn.id = "modalCheckAvailabilityBtn";
      modalCheckAvailabilityBtn.addEventListener("click", handleCheckAvailability);
    }
    bookingModalForm.addEventListener("submit", (event) => event.preventDefault());
  }

  if (continueBookingBtn) {
    continueBookingBtn.id = "continueBtn";
    document.getElementById("continueBtn").addEventListener("click", async () => {

      const res = await fetch("https://restless-waterfall-a71b.tech-e7b.workers.dev/verify", {
        method: "POST"
      });

      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
      }
    });
  }

  const clearModalStatus = () => {
    setBookingStatus("", "");
  };

  if (modalDestination) {
    modalDestination.addEventListener("change", () => {
      resetModalAvailabilityState();
      clearModalStatus();
      syncAddonsGroupVisibility();
    });
  }

  if (modalCheckin) {
    modalCheckin.addEventListener("change", () => {
      resetModalAvailabilityState();
      clearModalStatus();
      updateTotal();
    });
  }

  if (modalCheckout) {
    modalCheckout.addEventListener("change", () => {
      resetModalAvailabilityState();
      clearModalStatus();
      updateTotal();
    });
  }

  if (modalGuests) {
    modalGuests.addEventListener("change", () => {
      resetModalAvailabilityState();
      clearModalStatus();
    });
  }

  addonCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", updateTotal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && bookingModal.classList.contains("is-open")) {
      closeBookingModal();
    }
  });
}

// =========================================================
// Booking Summary Page
// =========================================================

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

// =========================================================
// Cactus Gallery + Lightbox
// =========================================================

const cactusGalleryState = {
  images: [],
  currentIndex: 0,
  touchStartX: null,
  touchEndX: null
};

function classifyImages(fileNames) {
  const indoorKeywords = [
    "living", "kitchen", "dining", "bedroom", "bath", "bathroom", "lounge", "suite", "interior", "room"
  ];
  const outdoorKeywords = [
    "pool", "garden", "backyard", "bbq", "grill", "firepit", "exterior", "outdoor", "patio", "yard"
  ];

  const result = { indoor: [], outdoor: [] };

  fileNames.forEach((file) => {
    const lower = file.toLowerCase();
    if (outdoorKeywords.some((keyword) => lower.includes(keyword))) {
      result.outdoor.push(file);
      return;
    }
    if (indoorKeywords.some((keyword) => lower.includes(keyword))) {
      result.indoor.push(file);
      return;
    }
    result.indoor.push(file);
  });

  return result;
}

function openLightbox(index) {
  const lightbox = document.getElementById("cactusLightbox");
  if (!lightbox || !cactusGalleryState.images.length) {
    return;
  }

  cactusGalleryState.currentIndex = index;
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  updateLightboxView();
}

function closeLightbox() {
  const lightbox = document.getElementById("cactusLightbox");
  if (!lightbox) {
    return;
  }

  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function showNextImage() {
  if (!cactusGalleryState.images.length) {
    return;
  }
  cactusGalleryState.currentIndex = (cactusGalleryState.currentIndex + 1) % cactusGalleryState.images.length;
  updateLightboxView();
}

function showPrevImage() {
  if (!cactusGalleryState.images.length) {
    return;
  }
  cactusGalleryState.currentIndex = (cactusGalleryState.currentIndex - 1 + cactusGalleryState.images.length) % cactusGalleryState.images.length;
  updateLightboxView();
}

function handleSwipe() {
  if (cactusGalleryState.touchStartX === null || cactusGalleryState.touchEndX === null) {
    return;
  }

  const deltaX = cactusGalleryState.touchStartX - cactusGalleryState.touchEndX;
  const threshold = 50;

  if (deltaX > threshold) {
    showNextImage();
  } else if (deltaX < -threshold) {
    showPrevImage();
  }

  cactusGalleryState.touchStartX = null;
  cactusGalleryState.touchEndX = null;
}

function createCactusGalleryItem(fileName, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lux-cactus-gallery-item";
  button.setAttribute("aria-label", `Open image ${index + 1}`);

  const img = document.createElement("img");
  img.loading = "lazy";
  img.src = imageSourceFromCactus(fileName);
  img.alt = `${makeImageLabel(fileName)} at Cactus & Chill House`;
  img.onerror = function () {
    this.onerror = null;
    this.src = "assets/images/placeholders/placeholder-800x600.svg";
  };

  button.addEventListener("click", () => {
    openLightbox(index);
  });

  button.appendChild(img);
  return button;
}

function createCactusTopItem(fileName, index, isMain) {
  const item = createCactusGalleryItem(fileName, index);
  if (isMain) {
    item.classList.add("is-main");
  }
  return item;
}

function renderCactusSections(classified) {
  const indoorTarget = document.getElementById("luxCactusIndoorGallery");
  const outdoorTarget = document.getElementById("luxCactusOutdoorGallery");
  const topTarget = document.getElementById("cactusTopGallery");

  if (!indoorTarget || !outdoorTarget || !topTarget) {
    return;
  }

  indoorTarget.innerHTML = "";
  outdoorTarget.innerHTML = "";
  topTarget.innerHTML = "";

  if (!classified.indoor.length) {
    classified.indoor.push("indoor-placeholder.jpg");
  }

  if (!classified.outdoor.length) {
    classified.outdoor.push("outdoor-placeholder.jpg");
  }

  const ordered = [...classified.outdoor, ...classified.indoor];
  cactusGalleryState.images = ordered;

  ordered.forEach((file, index) => {
    if (index < 5) {
      topTarget.appendChild(createCactusTopItem(file, index, index === 0));
    }
  });

  classified.indoor.forEach((file) => {
    const index = cactusGalleryState.images.indexOf(file);
    indoorTarget.appendChild(createCactusGalleryItem(file, index));
  });

  classified.outdoor.forEach((file) => {
    const index = cactusGalleryState.images.indexOf(file);
    outdoorTarget.appendChild(createCactusGalleryItem(file, index));
  });

  renderLightboxThumbs();
}

function renderLightboxThumbs() {
  const thumbStrip = document.getElementById("cactusThumbStrip");
  if (!thumbStrip) {
    return;
  }

  thumbStrip.innerHTML = "";

  cactusGalleryState.images.forEach((file, index) => {
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "lux-cactus-thumb";
    thumb.setAttribute("aria-label", `View image ${index + 1}`);

    const img = document.createElement("img");
    img.src = imageSourceFromCactus(file);
    img.alt = makeImageLabel(file);
    img.onerror = function () {
      this.onerror = null;
      this.src = "assets/images/placeholders/placeholder-600x400.svg";
    };

    thumb.addEventListener("click", () => {
      cactusGalleryState.currentIndex = index;
      updateLightboxView();
    });

    thumb.appendChild(img);
    thumbStrip.appendChild(thumb);
  });
}

function updateLightboxView() {
  const imageEl = document.getElementById("cactusLightboxImage");
  const thumbs = document.querySelectorAll(".lux-cactus-thumb");

  if (!imageEl || !cactusGalleryState.images.length) {
    return;
  }

  const fileName = cactusGalleryState.images[cactusGalleryState.currentIndex];
  imageEl.src = imageSourceFromCactus(fileName);
  imageEl.alt = `${makeImageLabel(fileName)} at Cactus & Chill House`;
  imageEl.onerror = function () {
    this.onerror = null;
    this.src = "assets/images/placeholders/placeholder-800x600.svg";
  };

  thumbs.forEach((thumb, index) => {
    thumb.classList.toggle("is-active", index === cactusGalleryState.currentIndex);
  });
}

function initCactusPage() {
  const topGallery = document.getElementById("cactusTopGallery");
  if (!topGallery) {
    return;
  }

  const cactusFiles = [
    "Living Room Closeup.png",
    "Kitchen Vibrant.png",
    "Primary Bedroom.jpg",
    "Primary Bathroom Vibrant.png",
    "Primary closeup.png",
    "Primary desk.png",
    "Firepit Closeup.png",
    "Firepit Seating.png",
    "Firepit Solo.png"
  ];

  const classified = classifyImages(cactusFiles);
  renderCactusSections(classified);

  const closeTriggers = document.querySelectorAll("[data-cactus-close-lightbox]");
  closeTriggers.forEach((trigger) => trigger.addEventListener("click", closeLightbox));

  const nextBtn = document.getElementById("cactusNextBtn");
  const prevBtn = document.getElementById("cactusPrevBtn");

  if (nextBtn) {
    nextBtn.addEventListener("click", showNextImage);
  }
  if (prevBtn) {
    prevBtn.addEventListener("click", showPrevImage);
  }

  const lightboxPanel = document.querySelector(".lux-cactus-lightbox-panel");
  if (lightboxPanel) {
    lightboxPanel.addEventListener("touchstart", (event) => {
      cactusGalleryState.touchStartX = event.changedTouches[0].screenX;
    }, { passive: true });

    lightboxPanel.addEventListener("touchend", (event) => {
      cactusGalleryState.touchEndX = event.changedTouches[0].screenX;
      handleSwipe();
    }, { passive: true });
  }

  document.addEventListener("keydown", (event) => {
    const lightbox = document.getElementById("cactusLightbox");
    if (!lightbox || !lightbox.classList.contains("is-open")) {
      return;
    }

    if (event.key === "Escape") {
      closeLightbox();
    } else if (event.key === "ArrowRight") {
      showNextImage();
    } else if (event.key === "ArrowLeft") {
      showPrevImage();
    }
  });

  const cactusForm = document.getElementById("cactusBookingForm");
  if (cactusForm) {
    cactusForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const checkin = document.getElementById("luxCactusCheckin");
      const checkout = document.getElementById("luxCactusCheckout");
      const guests = document.getElementById("luxCactusGuests");

      if (!checkin || !checkout || !guests || !checkin.value || !checkout.value || !guests.value) {
        setInlineFormError(cactusForm, "Please complete check-in, check-out, and guests.");
        return;
      }

      if (new Date(checkout.value) <= new Date(checkin.value)) {
        setInlineFormError(cactusForm, "Check-out must be later than check-in.");
        return;
      }

      setInlineFormError(cactusForm, "");

      const params = new URLSearchParams({
        destination: "cactus",
        checkin: checkin.value,
        checkout: checkout.value,
        guests: guests.value
      });

      window.location.href = `booking.html?${params.toString()}`;
    });
  }
}

// =========================================================
// Pine Gallery + Lightbox
// =========================================================

const pineGalleryState = {
  images: [],
  currentIndex: 0,
  touchStartX: null,
  touchEndX: null
};

const pineImages = [
  "assets/images/pine/pnc1.png",
  "assets/images/pine/pnc2.png",
  "assets/images/pine/pnc3.png",
  "assets/images/pine/pnc4.png",
  "assets/images/pine/pnc5.png"
];

const pineImageLabels = {
  "assets/images/pine/pnc1.png": "Pine and Peace outdoor hero",
  "assets/images/pine/pnc2.png": "Pine and Peace indoor lounge",
  "assets/images/pine/pnc3.png": "Pine and Peace living area",
  "assets/images/pine/pnc4.png": "Pine and Peace bedroom suite",
  "assets/images/pine/pnc5.png": "Pine and Peace outdoor experience"
};

const pineIndoorImageSet = new Set([
  "assets/images/pine/pnc2.png",
  "assets/images/pine/pnc3.png",
  "assets/images/pine/pnc4.png"
]);

const pineOutdoorImageSet = new Set([
  "assets/images/pine/pnc1.png",
  "assets/images/pine/pnc5.png"
]);

function classifyPineImages(filePaths) {
  return {
    indoor: filePaths.filter((imagePath) => pineIndoorImageSet.has(imagePath)),
    outdoor: filePaths.filter((imagePath) => pineOutdoorImageSet.has(imagePath))
  };
}

function pineSourceForFile(imageSrc) {
  return imageSrc;
}

function pineLabelForImage(imageSrc) {
  return pineImageLabels[imageSrc] || "Pine and Peace image";
}

function openPineLightbox(index) {
  const lightbox = document.getElementById("pineLightbox");
  if (!lightbox || !pineGalleryState.images.length) {
    return;
  }
  pineGalleryState.currentIndex = index;
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  updatePineLightboxView();
}

function closePineLightbox() {
  const lightbox = document.getElementById("pineLightbox");
  if (!lightbox) {
    return;
  }
  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function showNextPineImage() {
  if (!pineGalleryState.images.length) {
    return;
  }
  pineGalleryState.currentIndex = (pineGalleryState.currentIndex + 1) % pineGalleryState.images.length;
  updatePineLightboxView();
}

function showPrevPineImage() {
  if (!pineGalleryState.images.length) {
    return;
  }
  pineGalleryState.currentIndex = (pineGalleryState.currentIndex - 1 + pineGalleryState.images.length) % pineGalleryState.images.length;
  updatePineLightboxView();
}

function handlePineSwipe() {
  if (pineGalleryState.touchStartX === null || pineGalleryState.touchEndX === null) {
    return;
  }
  const deltaX = pineGalleryState.touchStartX - pineGalleryState.touchEndX;
  if (deltaX > 50) {
    showNextPineImage();
  } else if (deltaX < -50) {
    showPrevPineImage();
  }
  pineGalleryState.touchStartX = null;
  pineGalleryState.touchEndX = null;
}

function createPineGalleryItem(imageSrc, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lux-pine-gallery-item";
  button.setAttribute("aria-label", `Open image ${index + 1}`);

  const img = document.createElement("img");
  img.loading = "lazy";
  img.onerror = function () {
    this.onerror = null;
    this.src = "assets/images/placeholders/placeholder-800x600.svg";
  };
  img.src = pineSourceForFile(imageSrc);
  img.alt = pineLabelForImage(imageSrc);

  button.addEventListener("click", () => {
    openPineLightbox(index);
  });

  button.appendChild(img);
  return button;
}

function renderPineLightboxThumbs() {
  const strip = document.getElementById("pineThumbStrip");
  if (!strip) {
    return;
  }

  strip.innerHTML = "";
  pineGalleryState.images.forEach((imageSrc, index) => {
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "lux-pine-thumb";
    thumb.setAttribute("aria-label", `View image ${index + 1}`);

    const img = document.createElement("img");
    img.onerror = function () {
      this.onerror = null;
      this.src = "assets/images/placeholders/placeholder-600x400.svg";
    };
    img.src = pineSourceForFile(imageSrc);
    img.alt = pineLabelForImage(imageSrc);

    thumb.addEventListener("click", () => {
      pineGalleryState.currentIndex = index;
      updatePineLightboxView();
    });

    thumb.appendChild(img);
    strip.appendChild(thumb);
  });
}

function updatePineLightboxView() {
  const imageEl = document.getElementById("pineLightboxImage");
  const thumbs = document.querySelectorAll(".lux-pine-thumb");

  if (!imageEl || !pineGalleryState.images.length) {
    return;
  }

  const imageSrc = pineGalleryState.images[pineGalleryState.currentIndex];
  imageEl.onerror = function () {
    this.onerror = null;
    this.src = "assets/images/placeholders/placeholder-800x600.svg";
  };
  imageEl.src = pineSourceForFile(imageSrc);
  imageEl.alt = pineLabelForImage(imageSrc);

  thumbs.forEach((thumb, idx) => {
    thumb.classList.toggle("is-active", idx === pineGalleryState.currentIndex);
  });
}

function initPinePage() {
  const topGallery = document.getElementById("pineTopGallery");
  if (!topGallery) {
    return;
  }

  const classified = classifyPineImages(pineImages);
  if (!classified.indoor.length) {
    classified.indoor.push("assets/images/placeholders/placeholder-800x600.svg");
  }
  if (!classified.outdoor.length) {
    classified.outdoor.push("assets/images/placeholders/placeholder-800x600.svg");
  }

  pineGalleryState.images = [...pineImages];

  const indoorTarget = document.getElementById("pineIndoorGallery");
  const outdoorTarget = document.getElementById("pineOutdoorGallery");
  if (!indoorTarget || !outdoorTarget) {
    return;
  }
  topGallery.innerHTML = "";
  indoorTarget.innerHTML = "";
  outdoorTarget.innerHTML = "";

  pineGalleryState.images.forEach((imageSrc, index) => {
    if (index < 5) {
      const topItem = createPineGalleryItem(imageSrc, index);
      if (index === 0) {
        topItem.classList.add("is-main");
      }
      topGallery.appendChild(topItem);
    }
  });

  classified.indoor.forEach((imageSrc) => {
    indoorTarget.appendChild(createPineGalleryItem(imageSrc, pineGalleryState.images.indexOf(imageSrc)));
  });
  classified.outdoor.forEach((imageSrc) => {
    outdoorTarget.appendChild(createPineGalleryItem(imageSrc, pineGalleryState.images.indexOf(imageSrc)));
  });

  renderPineLightboxThumbs();

  document.querySelectorAll("[data-pine-close-lightbox]").forEach((trigger) => {
    trigger.addEventListener("click", closePineLightbox);
  });

  const nextBtn = document.getElementById("pineNextBtn");
  const prevBtn = document.getElementById("pinePrevBtn");
  if (nextBtn) {
    nextBtn.addEventListener("click", showNextPineImage);
  }
  if (prevBtn) {
    prevBtn.addEventListener("click", showPrevPineImage);
  }

  const panel = document.querySelector(".lux-pine-lightbox-panel");
  if (panel) {
    panel.addEventListener("touchstart", (event) => {
      pineGalleryState.touchStartX = event.changedTouches[0].screenX;
    }, { passive: true });

    panel.addEventListener("touchend", (event) => {
      pineGalleryState.touchEndX = event.changedTouches[0].screenX;
      handlePineSwipe();
    }, { passive: true });
  }

  document.addEventListener("keydown", (event) => {
    const lightbox = document.getElementById("pineLightbox");
    if (!lightbox || !lightbox.classList.contains("is-open")) {
      return;
    }
    if (event.key === "Escape") {
      closePineLightbox();
    } else if (event.key === "ArrowRight") {
      showNextPineImage();
    } else if (event.key === "ArrowLeft") {
      showPrevPineImage();
    }
  });

  const pineForm = document.getElementById("pineBookingForm");
  if (pineForm) {
    pineForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const checkin = document.getElementById("luxPineCheckin");
      const checkout = document.getElementById("luxPineCheckout");
      const guests = document.getElementById("luxPineGuests");

      if (!checkin || !checkout || !guests || !checkin.value || !checkout.value || !guests.value) {
        setInlineFormError(pineForm, "Please complete check-in, check-out, and guests.");
        return;
      }
      if (new Date(checkout.value) <= new Date(checkin.value)) {
        setInlineFormError(pineForm, "Check-out must be later than check-in.");
        return;
      }

      setInlineFormError(pineForm, "");

      const params = new URLSearchParams({
        destination: "pine",
        checkin: checkin.value,
        checkout: checkout.value,
        guests: guests.value
      });
      window.location.href = `booking.html?${params.toString()}`;
    });
  }
}

// =========================================================
// Homepage interactions
// =========================================================

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
  const homeCheckAvailabilityBtn = bookingForm.querySelector("button[type=\"submit\"]");
  if (homeCheckAvailabilityBtn) {
    homeCheckAvailabilityBtn.id = "checkAvailabilityBtn";
    homeCheckAvailabilityBtn.addEventListener("click", handleCheckAvailability);
  }
  bookingForm.addEventListener("submit", (event) => event.preventDefault());
}

if (tabs.length) {
  const collectionHero = document.getElementById("collectionHero");
  const imageEl = document.getElementById("collectionImage");
  const kickerEl = document.getElementById("collectionKicker");
  const titleEl = document.getElementById("collectionTitle");
  const textEl = document.getElementById("collectionText");
  const prevBtn = document.getElementById("collectionPrevBtn");
  const nextBtn = document.getElementById("collectionNextBtn");
  let collectionCarouselTimer = null;
  let collectionCarouselIndex = 0;
  let activeImages = [];

  function setCollectionImage(imageSrc) {
    if (!imageEl) {
      return;
    }
    imageEl.classList.add("is-swapping");
    window.setTimeout(() => {
      imageEl.src = imageSrc;
      imageEl.classList.remove("is-swapping");
    }, 140);
  }

  function stopCollectionCarousel() {
    if (collectionCarouselTimer) {
      window.clearInterval(collectionCarouselTimer);
      collectionCarouselTimer = null;
    }
  }

  function showCollectionImageAt(index) {
    if (!activeImages.length) {
      return;
    }
    collectionCarouselIndex = (index + activeImages.length) % activeImages.length;
    setCollectionImage(activeImages[collectionCarouselIndex]);
    imageEl.alt = "Cactus and Chill featured collection image";
  }

  function showNextCollectionImage() {
    showCollectionImageAt(collectionCarouselIndex + 1);
  }

  function showPrevCollectionImage() {
    showCollectionImageAt(collectionCarouselIndex - 1);
  }

  function startCollectionCarousel(images) {
    if (!imageEl || !images || !images.length) {
      return;
    }

    stopCollectionCarousel();

    activeImages = [...new Set(images)];
    collectionCarouselIndex = 0;
    showCollectionImageAt(collectionCarouselIndex);

    collectionCarouselTimer = window.setInterval(() => {
      showNextCollectionImage();
    }, 3200);
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((button) => button.classList.remove("is-active"));
      tab.classList.add("is-active");

      const key = tab.getAttribute("data-tab");
      const item = key ? collectionData[key] : null;

      if (!item || !imageEl || !kickerEl || !titleEl || !textEl) {
        return;
      }

      kickerEl.textContent = item.kicker;
      titleEl.textContent = item.title;
      textEl.textContent = item.text;
      startCollectionCarousel(item.images || [item.image]);
    });
  });

  const activeTab = document.querySelector(".tab.is-active");
  if (activeTab) {
    const key = activeTab.getAttribute("data-tab");
    const item = key ? collectionData[key] : null;
    if (item) {
      startCollectionCarousel(item.images || [item.image]);
    }
  }

  if (collectionHero) {
    collectionHero.addEventListener("mouseenter", stopCollectionCarousel);
    collectionHero.addEventListener("mouseleave", () => {
      if (activeImages.length) {
        startCollectionCarousel(activeImages);
      }
    });
    collectionHero.addEventListener("focusin", stopCollectionCarousel);
    collectionHero.addEventListener("focusout", () => {
      if (activeImages.length) {
        startCollectionCarousel(activeImages);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      stopCollectionCarousel();
      showNextCollectionImage();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      stopCollectionCarousel();
      showPrevCollectionImage();
    });
  }
}

if (inquiryButton) {
  inquiryButton.addEventListener("click", () => {
    openBookingModal();
  });
}

initBookingModalEvents();
initBookingPageSummary();
initCactusPage();
initPinePage();

// Expose required API surface
window.openBookingModal = openBookingModal;
window.closeBookingModal = closeBookingModal;
window.handleCheckAvailability = handleCheckAvailability;
window.checkAvailability = checkAvailability;
window.handlePayment = handlePayment;
window.classifyImages = classifyImages;
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;
window.showNextImage = showNextImage;
window.showPrevImage = showPrevImage;
window.handleSwipe = handleSwipe;
