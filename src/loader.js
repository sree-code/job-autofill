// The needle-and-thread loader. A needle bobs in place while gold stitches
// feed out behind it, like fabric under a sewing machine, so the loop never
// visibly restarts. When the work is done the needle lifts away and the seam
// bends into a checkmark; on an error it relaxes into a soft wave.
//
// Purpose: state indication (working / done / failed). Plain inline SVG, CSS
// for the loop, the Web Animations API for the one-shot finish. With reduced
// motion: no bobbing or marching, and the finish is a crossfade, not a bend.
(() => {
  const NS = (globalThis.JobAutofill ??= {});
  if (NS.loader) return;

  // Every seam shape is "M C C" so the browser can interpolate between them.
  const D = {
    line: "M4 14 C10 14 16 14 20 14 C26 14 32 14 36 14",
    check: "M12 13 C14.5 15 17 17 19.5 19 C24.5 14 29.5 9.5 35 5",
    wave: "M4 14 C9 8.5 15 8.5 20 14 C25 19.5 31 19.5 36 14",
  };
  const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
  const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  const CSS = `
  .ldr { display: block; overflow: visible; }
  .ldr .seam { fill: none; stroke: var(--thread); stroke-width: 2.4; stroke-linecap: round; stroke-dasharray: 4 3; }
  .ldr .ahead { fill: none; stroke: var(--label-3); stroke-width: 2; stroke-linecap: round; stroke-dasharray: 4 3; }
  .ldr .needle line { stroke: var(--needle, #8E96A8); stroke-width: 1.7; stroke-linecap: round; }
  .ldr .needle ellipse { fill: none; stroke: var(--needle, #8E96A8); stroke-width: 1.2; }
  .ldr .needle path { fill: none; stroke: var(--thread); stroke-width: 1.2; stroke-linecap: round; }
  .ldr .needle { transform-box: view-box; }
  .ldr[data-state=busy] .seam { animation: ldr-feed 520ms linear infinite; }
  .ldr[data-state=busy] .bob { animation: ldr-bob 260ms cubic-bezier(0.77, 0, 0.175, 1) infinite alternate; }
  .ldr[data-state=fail] .seam { stroke: var(--label-2); }
  @keyframes ldr-feed { to { stroke-dashoffset: 7; } }
  @keyframes ldr-bob { to { transform: translateY(3px); } }
  @media (prefers-reduced-motion: reduce) {
    .ldr[data-state=busy] .seam, .ldr[data-state=busy] .bob { animation: none; }
  }`;

  const SVG = `<svg class="ldr" viewBox="0 0 48 24" width="48" height="24" data-state="busy" aria-hidden="true">
    <path class="ahead" d="M40 14 L46 14"/>
    <path class="seam" d="${D.line}"/>
    <g class="needle"><g class="bob">
      <path d="M36 4.2 C40 3 42 7 40.5 10"/>
      <line x1="36" y1="2.5" x2="36" y2="15.5"/>
      <ellipse cx="36" cy="4.6" rx=".9" ry="1.7"/>
    </g></g>
  </svg>`;

  const parts = (svg) => ({ seam: svg.querySelector(".seam"), ahead: svg.querySelector(".ahead"), needle: svg.querySelector(".needle") });

  // Cancel any finish that's still running, then show the loop.
  function busy(svg) {
    if (!svg) return;
    const { seam, ahead, needle } = parts(svg);
    for (const el of [seam, ahead, needle]) for (const a of el.getAnimations()) if (!(a instanceof CSSAnimation)) a.cancel();
    seam.setAttribute("d", D.line);
    seam.style.opacity = ahead.style.opacity = needle.style.opacity = seam.style.strokeDashoffset = "";
    needle.style.transform = "";
    svg.dataset.state = "busy";
  }

  // Lift the needle away, then bend the seam into `shape`.
  async function finish(svg, shape, state) {
    if (!svg || svg.dataset.state === state) return;
    const { seam, ahead, needle } = parts(svg);
    seam.style.strokeDashoffset = getComputedStyle(seam).strokeDashoffset; // freeze the stitches where they are
    svg.dataset.state = state;
    const fadeOut = { opacity: 0 };
    if (reduced()) {
      needle.style.opacity = ahead.style.opacity = "0";
      await seam.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: EASE_OUT }).finished.catch(() => {});
      seam.setAttribute("d", D[shape]);
      seam.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: EASE_OUT });
      return;
    }
    needle.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(-5px)", ...fadeOut }], { duration: 160, easing: EASE_OUT, fill: "forwards" });
    ahead.animate([{ opacity: 1 }, fadeOut], { duration: 160, easing: EASE_OUT, fill: "forwards" });
    const bend = seam.animate([{ d: `path("${D.line}")` }, { d: `path("${D[shape]}")` }], { duration: 280, delay: 80, easing: EASE_IN_OUT, fill: "forwards" });
    await bend.finished.catch(() => {});
    if (svg.dataset.state === state) seam.setAttribute("d", D[shape]);
  }

  NS.loader = {
    CSS,
    SVG,
    EASE_OUT,
    EASE_IN_OUT,
    EASE_DRAWER: "cubic-bezier(0.32, 0.72, 0, 1)",
    busy,
    done: (svg) => finish(svg, "check", "done"),
    fail: (svg) => finish(svg, "wave", "fail"),
    reduced,
  };
})();
