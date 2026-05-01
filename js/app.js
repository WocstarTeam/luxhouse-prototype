document.addEventListener("DOMContentLoaded", () => {
  async function checkAvailability(event) {
    if (event) {
      event.preventDefault();
    }

    const checkinInput = document.querySelector('[name="checkin"]');
    const checkoutInput = document.querySelector('[name="checkout"]');
    const resultEl = document.getElementById("availabilityResult");

    if (!checkinInput || !checkoutInput || !resultEl) {
      return;
    }

    const payload = {
      checkin: checkinInput.value,
      checkout: checkoutInput.value
    };

    console.log("Sending:", payload);

    try {
      const res = await fetch("https://restless-waterfall-a71b.tech-e7b.workers.dev/availability", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      console.log("Response:", data);

      if (data.available === true) {
        resultEl.textContent = "Available for your dates";
      } else {
        resultEl.textContent = "Not available";
      }
    } catch (error) {
      console.error(error);
      resultEl.textContent = "Not available";
    }
  }

  async function continueToBooking(event) {
    if (event) {
      event.preventDefault();
    }

    const requestId = "LUX-" + Date.now();
    const payload = { requestId };

    console.log("Sending:", payload);

    try {
      const res = await fetch("https://restless-waterfall-a71b.tech-e7b.workers.dev/create-verification-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      console.log("Response:", data);

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error(error);
    }
  }

  const checkAvailabilityBtn = document.getElementById("checkAvailabilityBtn");
  const continueBtn = document.getElementById("continueBtn");

  if (checkAvailabilityBtn) {
    checkAvailabilityBtn.addEventListener("click", checkAvailability);
  }

  if (continueBtn) {
    continueBtn.addEventListener("click", continueToBooking);
  }
});
