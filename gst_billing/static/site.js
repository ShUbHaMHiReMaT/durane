// NEU-TECH website: mobile menu, enquiry basket, product search, lightbox, scroll effects
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---- header shadow on scroll
  const header = $("#header");
  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---- mobile menu
  const nav = $("#nav"), btn = $("#menu-btn");
  let backdrop = null;
  const closeMenu = () => {
    nav.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    backdrop?.remove(); backdrop = null;
    document.body.style.overflow = "";
  };
  btn.addEventListener("click", () => {
    if (nav.classList.contains("open")) return closeMenu();
    nav.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    backdrop = document.createElement("div");
    backdrop.className = "nav-backdrop";
    backdrop.onclick = closeMenu;
    document.body.appendChild(backdrop);
    document.body.style.overflow = "hidden";
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeMenu(); closeLightbox(); } });
  // on small screens the Products link opens its sub-menu first
  const dd = $(".dd");
  dd.querySelector(":scope > a").addEventListener("click", e => {
    if (window.matchMedia("(max-width: 1020px)").matches && !dd.classList.contains("open")) {
      e.preventDefault(); dd.classList.add("open");
    }
  });

  // ---- enquiry basket: sizes the visitor picked, carried into the enquiry form
  const KEY = "neutech-enquiry";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const save = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode */ } };
  let basket = load();
  const refresh = () => {
    $$(".basket-count").forEach(el => { el.hidden = !basket.length; el.textContent = basket.length; });
    $$(".add-btn[data-add]").forEach(b => {
      const on = basket.includes(b.dataset.add);
      b.classList.toggle("added", on);
      const label = b.querySelector(".add-label");
      if (label) label.textContent = on ? "Added" : "Enquire";
      b.setAttribute("aria-label", `${on ? "Remove" : "Add"} ${b.dataset.add} ${on ? "from" : "to"} enquiry`);
    });
    const field = $("#basket-field");
    if (field && !field.value && basket.length) field.value = basket.join(", ");
  };
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-add]");
    if (!b) return;
    const item = b.dataset.add;
    if (b.classList.contains("add-btn")) {
      e.preventDefault();
      basket = basket.includes(item) ? basket.filter(x => x !== item) : [...basket, item];
    } else if (!basket.includes(item)) {
      basket.push(item);
    }
    save(basket);
    refresh();
  });
  // clear the basket once an enquiry has been sent
  if ($(".form-done") && $("#enquiry")) { basket = []; save(basket); }
  refresh();

  // ---- product search
  const search = $("#product-search");
  if (search) {
    const results = $("#search-results"), grid = $("#family-grid"), none = $("#no-results");
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase().replace(/-/g, " ");
      results.hidden = !q;
      grid.hidden = !!q;
      let shown = 0;
      $$("tbody tr", results).forEach(tr => {
        const hit = q && tr.dataset.q.replace(/-/g, " ").includes(q);
        tr.hidden = !hit;
        if (hit) shown++;
      });
      none.hidden = !q || shown > 0;
      $(".table-scroll", results).hidden = shown === 0;
    });
  }

  // ---- lightbox
  const lb = $("#lightbox"), lbImg = $("img", lb), lbCap = $("figcaption", lb);
  let group = [], idx = 0;
  const show = i => {
    idx = (i + group.length) % group.length;
    const a = group[idx];
    lbImg.src = a.href;
    lbImg.alt = lbCap.textContent = a.querySelector("img")?.alt || "";
  };
  function closeLightbox() { if (!lb.hidden) { lb.hidden = true; document.body.style.overflow = ""; } }
  document.addEventListener("click", e => {
    const a = e.target.closest("a[data-lightbox]");
    if (!a) return;
    e.preventDefault();
    group = $$(`a[data-lightbox="${a.dataset.lightbox}"]`);
    show(group.indexOf(a));
    lb.hidden = false;
    document.body.style.overflow = "hidden";
  });
  $(".lb-close", lb).onclick = closeLightbox;
  $(".lb-prev", lb).onclick = () => show(idx - 1);
  $(".lb-next", lb).onclick = () => show(idx + 1);
  lb.addEventListener("click", e => { if (e.target === lb) closeLightbox(); });
  document.addEventListener("keydown", e => {
    if (lb.hidden) return;
    if (e.key === "ArrowLeft") show(idx - 1);
    if (e.key === "ArrowRight") show(idx + 1);
  });
  let touchX = null;
  lb.addEventListener("touchstart", e => (touchX = e.touches[0].clientX), { passive: true });
  lb.addEventListener("touchend", e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1));
    touchX = null;
  });

  // ---- right-click / view-source message (a friendly deterrent; the real protection is on the server)
  const QUOTES = [
    ["Nice try, explorer! 🕵️", "The developer of this site is a cybersecurity guy. Every door here is locked and logged."],
    ["Right-click is off duty 🔒", "Built by a cybersecurity guy. He sees you trying, and he respects the curiosity."],
    ["Looking for the source? 👀", "The developer is a cybersecurity guy. The only thing you'll find here is great tyre patches."],
    ["Access denied, politely 🛡️", "This website is guarded by a cybersecurity guy. Patches fix tyres, not security holes."],
    ["Hey there, hacker-in-training 😄", "You're on a site built by a cybersecurity guy. Want patches? Call us instead."],
  ];
  let guardTimer = null;
  const guardNote = () => {
    let el = $("#guard-note");
    if (!el) {
      el = document.createElement("div");
      el.id = "guard-note";
      el.className = "guard-note";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    const [title, text] = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    el.innerHTML = "";
    const b = document.createElement("b"); b.textContent = title;
    const p = document.createElement("p"); p.textContent = text;
    el.append(b, p);
    el.classList.add("show");
    clearTimeout(guardTimer);
    guardTimer = setTimeout(() => el.classList.remove("show"), 3800);
  };
  document.addEventListener("contextmenu", e => {
    if (e.target.closest("input, textarea")) return;  // allow copy/paste in form fields
    e.preventDefault();
    guardNote();
  });
  document.addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    if (k === "f12" || (e.ctrlKey && k === "u") || (e.ctrlKey && e.shiftKey && ["i", "j", "c"].includes(k))) {
      e.preventDefault();
      guardNote();
    }
  });
  $$("img").forEach(img => img.setAttribute("draggable", "false"));

  // ---- gentle reveal of cards as they scroll into view
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }), { rootMargin: "0px 0px -40px 0px" });
    $$(".family-card, .strength, .app-strip li, .g-item, .value, .steps li, .sel-row, .cat-block, .c-card").forEach(el => {
      el.classList.add("reveal");
      io.observe(el);
    });
  }
})();
