document.addEventListener("DOMContentLoaded", () => {

  const checkBtn = document.getElementById("checkAvailabilityBtn");
  const bookBtn = document.getElementById("continueBtn");

  // =========================
  // CHECK AVAILABILITY
  // =========================
  if (checkBtn) {
    checkBtn.addEventListener("click", async () => {
      try {
        const checkin = document.querySelector('[name="checkin"]').value;
        const checkout = document.querySelector('[name="checkout"]').value;

        console.log("Checking availability:", checkin, checkout);

        const res = await fetch("https://restless-waterfall-a71b.tech-e7b.workers.dev/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkin, checkout }),
        });

        const data = await res.json();
        console.log("Availability response:", data);

        const result = document.getElementById("availabilityResult");
        if (result) {
          result.textContent = data.available
            ? "Available for your dates"
            : "Not available";
        }

      } catch (err) {
        console.error("Availability error:", err);
      }
    });
  }

  // =========================
  // CONTINUE TO BOOKING
  // =========================
  if (bookBtn) {
    bookBtn.addEventListener("click", async () => {
      try {
        console.log("Booking button clicked");

        const requestId = "LUX-" + Date.now();

        const res = await fetch("https://restless-waterfall-a71b.tech-e7b.workers.dev/create-verification-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId }),
        });

        const data = await res.json();
        console.log("Stripe session:", data);

        if (data.url) {
          window.location.href = data.url;
        } else {
          alert("No verification URL returned");
        }

      } catch (err) {
        console.error("Booking error:", err);
        alert("Booking failed. Check console.");
      }
    });
  }

});
