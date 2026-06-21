(function () {
  const holder = document.getElementById("star-rain");
  if (!holder) return;

  for (let i = 0; i < 80; i++) {
    const star = document.createElement("div");
    star.className = "falling-star";
    star.textContent = "★";

    star.style.left = Math.random() * 100 + "vw";
    star.style.top = -Math.random() * window.innerHeight + "px";
    star.style.fontSize = 8 + Math.random() * 22 + "px";
    star.style.animationDuration = 10 + Math.random() * 20 + "s";
    star.style.animationDelay = -Math.random() * 30 + "s";
    star.style.setProperty("--drift", Math.random());

    holder.appendChild(star);
  }
})();
