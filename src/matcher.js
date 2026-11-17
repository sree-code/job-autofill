// Field discovery + semantic matching: figure out what each form control is asking for.
(() => {
  const NS = (globalThis.JobAutofill ??= {});

  // Order matters: more specific rules first. Each rule maps to a profile key.
  const RULES = [
    // Yes/no screening questions first: their long text often contains words like "United" or "name".
    ["workAuthorized", /(legally[\s_-]*)?(authori[sz]ed|eligible)[\s_-]*to[\s_-]*work/i],
    ["needsSponsorship", /sponsor/i],
    ["willingToRelocate", /relocat/i],
    ["firstName", /\b(first|given|fore)[\s_-]*name\b|^fname$|first_name/i],
    ["lastName", /\b(last|family|sur)[\s_-]*name\b|^lname$|last_name|surname/i],
    ["middleName", /middle[\s_-]*name/i],
    ["preferredName", /preferred[\s_-]*(first[\s_-]*)?name|nick[\s_-]*name/i],
    ["fullName", /^(full[\s_-]*)?name$|full[\s_-]*name|your[\s_-]*name|legal[\s_-]*name/i],
    ["email", /e-?mail/i],
    ["phone", /phone|mobile|cell|telephone|tel\b/i],
    ["linkedin", /linked[\s_-]*in/i],
    ["github", /git[\s_-]*hub/i],
    ["portfolio", /portfolio|personal[\s_-]*(web)?site|website|blog|url/i],
    ["address1", /address[\s_-]*(line)?[\s_-]*1|street|^address$/i],
    ["address2", /address[\s_-]*(line)?[\s_-]*2|\bapt\b|\bsuite\b|\bunit\b/i],
    ["city", /\bcity\b|town/i],
    ["state", /\bstate\b|province|region/i],
    ["postalCode", /zip|postal|post[\s_-]*code/i],
    ["country", /country/i],
    ["location", /current[\s_-]*location|^location$|where.*(located|based)/i],
    ["currentCompany", /current[\s_-]*(company|employer)|^company$|employer/i],
    ["currentTitle", /current[\s_-]*(title|role|position)|job[\s_-]*title/i],
    ["yearsExperience", /years?[\s_-]*(of)?[\s_-]*experience/i],
    ["school", /school|university|college|institution/i],
    ["degree", /degree/i],
    ["major", /major|field[\s_-]*of[\s_-]*study|discipline/i],
    ["gradYear", /grad(uation)?[\s_-]*(year|date)/i],
    ["salary", /salary|compensation|pay[\s_-]*expectation/i],
    ["startDate", /start[\s_-]*date|available[\s_-]*(to)?[\s_-]*start|notice[\s_-]*period/i],
    ["gender", /gender|\bsex\b/i],
    ["race", /race|ethnic/i],
    ["hispanic", /hispanic|latino/i],
    ["veteran", /veteran/i],
    ["disability", /disabilit/i],
    ["pronouns", /pronoun/i],
    ["howHeard", /how[\s_-]*did[\s_-]*you[\s_-]*hear|source|referr(al|ed)/i],
    ["resume", /resume|cv\b|curriculum/i],
    ["coverLetter", /cover[\s_-]*letter/i],
  ];

  // Collect all controls, including those inside open shadow roots.
  function collectControls(root = document) {
    const out = [];
    const walk = (node) => {
      node.querySelectorAll("input, select, textarea, [role=combobox], [contenteditable=true]").forEach((el) => out.push(el));
      node.querySelectorAll("*").forEach((el) => el.shadowRoot && walk(el.shadowRoot));
    };
    walk(root);
    return out.filter(isFillable);
  }

  function isFillable(el) {
    if (el.disabled || el.readOnly) return false;
    const t = (el.type || "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "password", "search"].includes(t)) return false;
    if (t !== "file") {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
    }
    return true;
  }

  const textOf = (n) => (n?.textContent || "").replace(/\s+/g, " ").trim();

  // Build the human-readable description of what a field is asking.
  function describe(el) {
    const parts = [];
    const root = el.getRootNode();
    if (el.labels?.length) parts.push(...[...el.labels].map(textOf));
    if (el.id && root.querySelector) {
      const l = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) parts.push(textOf(l));
    }
    const lb = el.getAttribute("aria-labelledby");
    if (lb) lb.split(/\s+/).forEach((id) => parts.push(textOf(root.getElementById?.(id) || document.getElementById(id))));
    parts.push(el.getAttribute("aria-label"), el.placeholder, el.name, el.id, el.getAttribute("data-automation-id"), el.getAttribute("autocomplete"));
    // Fallback: nearest preceding label-ish text in the containing field group.
    if (!parts.filter(Boolean).join("").trim()) {
      const group = el.closest("fieldset, .field, .form-group, [class*=question], [class*=field], li, div");
      const legend = group?.querySelector("legend, label, .label, h3, h4, p");
      if (legend) parts.push(textOf(legend));
    }
    // Radios/checkboxes: the question is usually the fieldset legend.
    if (el.type === "radio" || el.type === "checkbox") {
      const fs = el.closest("fieldset, [role=radiogroup], [role=group]");
      const q = fs?.querySelector("legend, [class*=label], label");
      if (q) parts.unshift(textOf(q));
    }
    return parts.filter(Boolean).join(" | ").slice(0, 400);
  }

  const AUTOCOMPLETE = {
    "given-name": "firstName", "family-name": "lastName", name: "fullName", email: "email", tel: "phone",
    "address-line1": "address1", "address-line2": "address2", "address-level2": "city", "address-level1": "state",
    "postal-code": "postalCode", "country-name": "country", country: "country", organization: "currentCompany",
    "organization-title": "currentTitle", url: "portfolio",
  };

  function classify(el) {
    if (el.type === "file") {
      const d = describe(el);
      return /cover/i.test(d) ? "coverLetter" : "resume";
    }
    if (el.type === "email") return "email";
    if (el.type === "tel") return "phone";
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (AUTOCOMPLETE[ac]) return AUTOCOMPLETE[ac];
    const d = describe(el);
    for (const [key, re] of RULES) if (re.test(d)) return key;
    return null;
  }

  NS.matcher = { collectControls, describe, classify, RULES };
})();
