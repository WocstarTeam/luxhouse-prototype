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

const collectionData = {
  fan: {
    image: "Firepit%20Solo.png",
    kicker: "Most booked this season",
    title: "Fan Favorites",
    text: "Guest-loved homes with standout layouts, elevated amenities, and signature LuxHouse hosting details."
  },
  new: {
    image: "Primary%20closeup.png",
    kicker: "Freshly launched",
    title: "New Homes",
    text: "Recently added stays with updated interiors, thoughtful extras, and destination-first design."
  },
  group: {
    image: "Firepit%20Seating.png",
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
    window.alert("Thanks. A LuxHouse advisor will reach out with guesthouse options and next steps.");
  });
}
