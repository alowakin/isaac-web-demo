// Shared behavior for content pages: mobile menu, footer year
(function () {
  const toggle = document.getElementById("menuToggle"), links = document.getElementById("navLinks");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open);
    });
    links.addEventListener("click", (e) => {
      if (e.target.tagName === "A") { links.classList.remove("open"); toggle.setAttribute("aria-expanded", false); }
    });
  }
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
})();
