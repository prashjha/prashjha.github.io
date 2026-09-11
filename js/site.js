/* Foundation behaviours: scroll reveal + motion-preference respect.
   Everything degrades to plain static content without JS. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* Simulation loops are decorative. Honour the OS preference, and stop
     paying for offscreen decode on long pages. */
  var vio = null;

  function onScreen(v) {
    var r = v.getBoundingClientRect();
    // A theme variant that is not the active one is display:none and has no
    // box. Zero area means "not showing", not "scrolled away".
    if (r.width === 0 || r.height === 0) return false;
    // Both axes. The showcase rail drifts horizontally, so most of its tiles
    // are off to one side while the section is squarely in view; a
    // vertical-only test called every tile visible and started that many
    // streams at once — which on one connection pool starves everything else,
    // including the images the page needs.
    var vh = window.innerHeight || 0, vw = window.innerWidth || 0;
    return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  }

  function play(v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }

  function governVideos() {
    var vids = document.querySelectorAll("video[aria-hidden='true']");
    if (!vids.length) return;

    if (reduced.matches) {
      vids.forEach(function (v) { v.pause(); v.removeAttribute("autoplay"); });
      return;
    }

    // Both theme variants ship preload="none" so a visitor never downloads the
    // half they cannot see; whichever is actually on screen is loaded by the
    // play() call below.
    vids.forEach(function (v) { if (onScreen(v)) play(v); else v.pause(); });

    if (!("IntersectionObserver" in window)) return;
    if (vio) { vids.forEach(function (v) { vio.observe(v); }); return; }

    // The observer alone is not enough: its first callback can run before the
    // stylesheet has applied, when every element still measures zero, and it
    // would then pause the lot and never fire again. It handles scrolling; the
    // pass above and the rAF below handle the initial and post-theme state.
    vio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting && onScreen(v)) play(v); else v.pause();
      });
    }, { rootMargin: "0px", threshold: 0.01 });

    vids.forEach(function (v) { vio.observe(v); });
  }

  function settle() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.querySelectorAll("video[aria-hidden='true']").forEach(function (v) {
          if (!reduced.matches && onScreen(v) && v.paused) play(v);
        });
      });
    });
  }
  window.__settleVideos = settle;

  function reveal() {
    var els = document.querySelectorAll(".reveal");
    if (!els.length) return;
    if (reduced.matches || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8%" });
    els.forEach(function (el) { io.observe(el); });
  }

  window.__governVideos = governVideos;

  /* ---------- Showcase rail: endless in both directions ----------

     The first version of this rail did not move. It shipped four clips cloned
     three times -- twenty-four <video> elements for four sources -- sat parked
     at scrollLeft 1925 with `scrollbar-width: none` and no arrows, and had
     neither a CSS animation nor any JS driving it. So the visitor landed
     mid-tile with the leftmost one guillotined by the window edge, and eight of
     the twelve tiles were unreachable by any means.

     What follows is the same idea with the two missing halves supplied: real
     motion, and a way to take hold of it.

     It is endless without cloning anything. A tile that has been scrolled
     entirely off one end is moved to the other end, and the same width is
     added to or subtracted from scrollLeft -- which is a visual no-op, because
     by construction that tile was off screen and every remaining pixel stays
     exactly where it was. Recycling is gated on the direction of travel, so
     only one of the two moves is ever live at a time and they cannot fight
     each other. The effect is roughly a viewport of fresh runway ahead of the
     visitor at all times, in whichever direction they are going: drift right,
     flick left, drag the scrollbar, hold an arrow -- it never reaches an end.

     Keeping the DOM at six tiles rather than twelve is the other half of the
     bargain: the video count stays at what the six sources actually need.

     It stops for anything that suggests the visitor wants it to: hover, focus,
     a touch, a wheel, a hidden tab, a scrolled-away section, or an OS-level
     request for reduced motion. */

  function railSetup(rail) {
    var track = rail.querySelector("[data-rail-track]");
    if (!track || !track.children.length) return;

    var section = rail.parentNode;
    while (section && String(section.className).indexOf("showcase") === -1) {
      section = section.parentNode;
    }
    var nav = section ? section.querySelector(".showcase-nav") : null;

    var SPEED = 90;          // px/s -- fast enough to feel alive, slow enough
                             // that a caption is still readable in passing
    var RESUME_AFTER = 2600; // ms of quiet before the drift takes over again

    var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    var pos = rail.scrollLeft;
    var last = 0;
    var raf = null;
    var held = 0;      // >0 while hover/focus is holding it
    var idleAt = 0;    // timestamp after which a transient hold expires
    var onscreen = true;
    var glide = 0;     // px an arrow press still owes us, eased off below

    // Not enough tiles to fill the viewport: a rail with nothing to scroll is
    // just a row, and it should not sprout arrows or start drifting.
    if (track.scrollWidth - rail.clientWidth < 24) return;
    if (nav) nav.hidden = false;

    function width(el) { return el.getBoundingClientRect().width + gap; }
    function put(v) { pos = v; rail.scrollLeft = v; }

    /* Move tiles that have gone fully past one end round to the other, in the
       direction of travel only. Each move is a visual no-op; what it buys is
       somewhere left to go. */
    function normalize(dir) {
      var guard = 0, el, w;
      if (dir >= 0) {
        // travelling right: retire the tile that has left the frame behind us
        while (guard++ < 24) {
          el = track.firstElementChild;
          if (!el) break;
          w = width(el);
          if (w <= 0 || pos < w) break;      // still partly on screen
          track.appendChild(el);
          put(pos - w);
        }
      } else {
        // travelling left: bring the far tile round in front of us
        while (guard++ < 24) {
          el = track.lastElementChild;
          if (!el) break;
          w = width(el);
          if (w <= 0) break;
          if (pos + rail.clientWidth > track.scrollWidth - w) break;  // still visible
          track.insertBefore(el, track.firstElementChild);
          put(pos + w);
        }
      }
    }

    function frame(t) {
      raf = null;
      if (!last) last = t;
      var dt = Math.min((t - last) / 1000, 0.1); // a backgrounded tab can hand
      last = t;                                   // back a multi-second gap

      if (!document.hidden && onscreen) {
        if (glide) {
          /* An arrow press is eased off here rather than handed to
             scrollTo({behavior:"smooth"}). The two cannot coexist: recycling
             writes scrollLeft, and any write cancels a smooth scroll, so the
             press would be swallowed mid-animation and the rail would sit
             where it started however many times it was clicked. Driving the
             step from the same loop that recycles keeps the two coherent, and
             lets repeated presses accumulate instead of interrupting. */
          var move = glide * Math.min(1, dt * 9);
          if (Math.abs(move) < 0.7 || Math.abs(glide) < 1) move = glide;
          put(pos + move);
          glide -= move;
          normalize(move);
        } else {
          var holding = held > 0 || (idleAt && t < idleAt);
          if (!holding && !reduced.matches) {
            put(pos + SPEED * dt);
            normalize(1);
          }
        }
      }
      schedule();
    }

    function schedule() {
      if (raf !== null) return;
      if (document.hidden || !onscreen) { last = 0; return; }
      // a pending arrow press still has to be delivered under reduced motion --
      // it is an explicit request, not decoration
      if (reduced.matches && !glide) { last = 0; return; }
      raf = requestAnimationFrame(frame);
    }

    function hold(on) { held += on ? 1 : -1; if (held < 0) held = 0; if (!on) last = 0; }
    function nudge() { idleAt = performance.now() + RESUME_AFTER; }

    rail.addEventListener("mouseenter", function () { hold(true); });
    rail.addEventListener("mouseleave", function () { hold(false); });
    rail.addEventListener("focusin", function () { hold(true); });
    rail.addEventListener("focusout", function () { hold(false); });
    rail.addEventListener("touchstart", nudge, { passive: true });
    rail.addEventListener("wheel", nudge, { passive: true });
    rail.addEventListener("pointerdown", nudge);

    /* The visitor may scroll it by hand -- a wheel, a swipe, a drag on the
       scrollbar, or a keyboard arrow while the rail has focus. Whenever the
       real position has parted company with ours, theirs wins, and we recycle
       in whichever direction they were heading so the end never arrives. */
    rail.addEventListener("scroll", function () {
      var d = rail.scrollLeft - pos;
      if (Math.abs(d) <= 1) return;   // our own write coming back to us
      pos = rail.scrollLeft;
      glide = 0;          // their gesture supersedes a half-finished arrow step
      nudge();
      normalize(d);
    }, { passive: true });

    /* One tile per press, in the direction asked for. Presses accumulate, so
       holding the button down walks the rail rather than restarting a step. */
    function step(dir) {
      nudge();
      normalize(dir);
      var target = dir > 0 ? track.firstElementChild : track.lastElementChild;
      var by = target ? width(target) : rail.clientWidth * 0.8;
      glide += dir * by;
      schedule();
    }

    if (nav) {
      var prev = nav.querySelector("[data-rail-prev]");
      var next = nav.querySelector("[data-rail-next]");
      if (prev) prev.addEventListener("click", function () { step(-1); });
      if (next) next.addEventListener("click", function () { step(1); });
    }

    // Do not animate a section nobody is looking at.
    if ("IntersectionObserver" in window && section) {
      new IntersectionObserver(function (entries) {
        onscreen = entries[0].isIntersecting;
        if (onscreen) schedule();
      }, { threshold: 0 }).observe(section);
    }

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) schedule();
    });
    reduced.addEventListener && reduced.addEventListener("change", function () {
      last = 0; schedule();
    });
    window.addEventListener("resize", function () {
      gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      pos = rail.scrollLeft;
      normalize(-1);
    });

    /* Start with runway already behind us. Without this the first leftward
       gesture is clamped at scrollLeft 0 by the browser before our scroll
       handler ever sees it, and the rail feels walled on one side exactly once
       -- which is the impression the whole thing exists to avoid. */
    normalize(-1);

    schedule();
  }

  function rails() {
    document.querySelectorAll("[data-rail]").forEach(railSetup);
  }

  function init() { rails(); governVideos(); reveal(); settle(); }
  window.addEventListener("load", settle);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }

  reduced.addEventListener && reduced.addEventListener("change", governVideos);
})();

/* Theme toggle. The initial value is set inline in <head> to avoid a flash;
   this only handles the click and remembers the choice. */
(function () {
  "use strict";
  var root = document.documentElement;

  function apply(theme) {
    // Suppress transitions for the swap itself, so a button's fill and its
    // label do not arrive out of step and leave the text briefly invisible.
    // The class disables every transition on the page while it is set, so it
    // is cleared by a timer as well as by rAF — rAF is throttled in a
    // background tab, and a stuck class would cost the site all its motion.
    root.classList.add("is-theming");
    root.setAttribute("data-theme", theme);
    var clear = function () { root.classList.remove("is-theming"); };
    requestAnimationFrame(function () { requestAnimationFrame(clear); });
    setTimeout(clear, 120);
    try { localStorage.setItem("theme", theme); } catch (e) {}
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
    });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-theme-toggle]");
    if (!btn) return;
    apply(root.getAttribute("data-theme") === "light" ? "dark" : "light");
    // the variant that just became visible has never been asked to play
    if (window.__settleVideos) window.__settleVideos();
  });
})();





/* Filter a record list by research thrust. Used by the publication index and
   the talks index; any list can opt in by marking a bar `[data-pubfilter]`,
   its rows `[data-thrusts]`, and (optionally) year groups `.js-group`.
   Progressive enhancement: the markup ships everything visible and this only
   ever hides rows, so with JS off the page is complete. */
(function () {
  document.querySelectorAll("[data-pubfilter]").forEach(function (bar) {
    var scope = bar.closest("[data-filter-scope]") || document;
    var rows = Array.prototype.slice.call(scope.querySelectorAll("[data-thrusts]"));
    var groups = Array.prototype.slice.call(scope.querySelectorAll(".js-group"));
    var empty = scope.querySelector(".pub-empty");
    var param = bar.dataset.pubfilter || "thrust";

    function apply(key) {
      rows.forEach(function (r) {
        r.hidden = !(key === "all" ||
          (" " + r.dataset.thrusts + " ").indexOf(" " + key + " ") > -1);
      });
      var shown = 0;
      groups.forEach(function (g) {
        var any = g.querySelector("[data-thrusts]:not([hidden])");
        g.hidden = !any;
        if (any) shown++;
      });
      if (empty) empty.hidden = groups.length ? shown > 0 : rows.some(function (r) { return !r.hidden; });
      bar.querySelectorAll(".chip").forEach(function (c) {
        c.classList.toggle("is-on", c.dataset.filter === key);
      });
      try {
        var u = new URL(location.href);
        if (key === "all") u.searchParams.delete(param); else u.searchParams.set(param, key);
        history.replaceState(null, "", u);
      } catch (e) { /* file:// and old browsers */ }
    }

    bar.addEventListener("click", function (e) {
      var c = e.target.closest(".chip");
      if (c) apply(c.dataset.filter);
    });

    // a link from a research page can arrive pre-filtered
    try {
      var want = new URL(location.href).searchParams.get(param);
      if (want && bar.querySelector('[data-filter="' + want + '"]')) apply(want);
    } catch (e) { /* ignore */ }
  });
})();


/* Copy-to-clipboard for the BibTeX block. Falls back to selecting the text when
   the clipboard API is unavailable (http:// origins, older browsers). */
(function () {
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-copy]");
    if (!b) return;
    var pre = b.parentNode.querySelector("pre");
    if (!pre) return;
    var text = pre.innerText;
    var done = function () {
      var was = b.textContent;
      b.textContent = "Copied";
      setTimeout(function () { b.textContent = was; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { select(pre); });
    } else { select(pre); }
    function select(el) {
      var r = document.createRange(); r.selectNodeContents(el);
      var s = getSelection(); s.removeAllRanges(); s.addRange(r);
      b.textContent = "Press " + (/Mac/.test(navigator.platform) ? "\u2318" : "Ctrl") + "-C";
    }
  });
})();


/* ---------- Nav overflow ----------
   In glyph mode the row is a line of fixed squares, so whether they fit is
   arithmetic the browser can answer: `nav-items` is allowed to shrink below
   its content and hide the excess, which makes scrollWidth > clientWidth the
   signal that something has been pushed out. Rather than let it wrap onto a
   second line and double the height of a sticky header, the tail moves into
   the More menu, where the names come back.

   Every pass starts by putting all of them back in the row, so growing the
   window is handled by the same code path as shrinking it. The call to action
   and the theme control live outside `nav-items` and are never moved. With JS
   off the menu stays hidden and the row simply carries everything, which is
   the pre-existing behaviour, not a broken one. */
(function () {
  var row = document.querySelector("[data-nav-items]");
  var more = document.querySelector("[data-nav-more]");
  var panel = document.querySelector("[data-nav-more-panel]");
  var btn = document.querySelector("[data-nav-more-btn]");
  if (!row || !more || !panel || !btn) return;

  var links = [].slice.call(row.children).filter(function (el) {
    return el.tagName === "A";
  });
  if (!links.length) return;

  function setOpen(open) {
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function fits() {
    // a sub-pixel slack: fractional layout widths otherwise read as overflow
    return row.scrollWidth <= row.clientWidth + 1;
  }

  function layout() {
    setOpen(false);
    // Clip for the duration of the measurement only. The row has to overflow
    // its box for scrollWidth to mean anything, but leaving it clipped would
    // cut off the hover chips and the More panel, both of which hang outside.
    row.style.overflow = "hidden";
    links.forEach(function (a) { row.insertBefore(a, more); });
    more.hidden = true;

    if (!fits()) {
      more.hidden = false;
      // keep at least one destination in the row; past that, take from the end
      for (var i = links.length - 1; i >= 1 && !fits(); i--) {
        panel.insertBefore(links[i], panel.firstChild);
      }
      if (!panel.children.length) more.hidden = true;
    }
    row.style.overflow = "visible";
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; layout(); });
  }

  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    setOpen(panel.hidden);
  });
  panel.addEventListener("click", function (e) {
    if (e.target.closest("a")) setOpen(false);
  });
  document.addEventListener("click", function (e) {
    if (!more.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setOpen(false);
  });

  if (window.ResizeObserver) {
    new ResizeObserver(schedule).observe(row.parentNode);
  } else {
    window.addEventListener("resize", schedule);
  }
  // the row is measured in whatever face is loaded, so measure it again once
  // the real one arrives and the names change width
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  layout();
})();

/* ---------- Back to top ----------
   `hidden` comes off only once there is somewhere to go back from, so the
   button is not in the tab order on a short page. The threshold is a viewport
   and a half: far enough that the header is long gone, near enough that it
   appears before anyone starts looking for it. Reduced motion gets an instant
   jump rather than a long smooth scroll. */
(function () {
  var btn = document.querySelector("[data-totop]");
  if (!btn) return;
  var SHOW_AT = 1.5;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var ticking = false;

  var hideTimer = null;

  function update() {
    ticking = false;
    var on = window.scrollY > window.innerHeight * SHOW_AT;
    if (on) {
      // a pending hide has to be cancelled, not left to fire: scroll down again
      // inside the fade-out and it would set `hidden` on a button that should
      // be showing, with no further scroll event coming to put it right
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (!btn.hidden) return;
      btn.hidden = false;
      // one frame with `hidden` off before the class, or the transition is skipped
      requestAnimationFrame(function () { btn.classList.add("is-shown"); });
    } else {
      if (btn.hidden || hideTimer) return;
      btn.classList.remove("is-shown");
      hideTimer = setTimeout(function () {
        hideTimer = null;
        btn.hidden = true;
      }, reduce.matches ? 0 : 220);
    }
  }

  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });

  btn.addEventListener("click", function () {
    // Focus first, scroll second. Moving focus during a smooth scroll cancels
    // it -- the page stayed exactly where it was while the heading took focus,
    // which is a working button that does nothing. Returning focus to the top
    // of the document matters for a keyboard user, who would otherwise be left
    // on a button that is about to hide itself.
    var h1 = document.querySelector("h1");
    if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: reduce.matches ? "auto" : "smooth" });
  });

  update();
})();
