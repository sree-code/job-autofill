// Per-ATS hints. Generic matching handles most sites; adapters add known field ids.
(() => {
  const NS = (globalThis.JobAutofill ??= {});

  const ADAPTERS = [
    {
      name: "workday",
      test: (h) => /myworkdayjobs\.com|workday\.com/.test(h),
      // Workday tags inputs with stable data-automation-id values.
      ids: {
        // Older data-automation-id style
        legalNameSection_firstName: "firstName", legalNameSection_lastName: "lastName",
        email: "email", phone: "phone", "phone-number": "phone", addressSection_addressLine1: "address1",
        addressSection_city: "city", addressSection_postalCode: "postalCode", linkedinQuestion: "linkedin",
        // Newer id style (name--legalName--firstName etc.)
        "name--legalName--firstName": "firstName", "name--legalName--lastName": "lastName",
        "name--preferredName--firstName": "preferredName", "address--addressLine1": "address1",
        "address--city": "city", "address--postalCode": "postalCode", "address--countryRegion": "state",
        "phoneNumber--phoneNumber": "phone", "phoneNumber--phoneType": "phoneDeviceType",
        "emailAddress--emailAddress": "email", "country--country": "country", "source--source": "howHeard",
      },
    },
    { name: "greenhouse", test: (h) => /greenhouse\.io/.test(h),
      ids: { first_name: "firstName", last_name: "lastName", email: "email", phone: "phone" } },
    { name: "lever", test: (h) => /lever\.co/.test(h),
      ids: { name: "fullName", email: "email", phone: "phone", org: "currentCompany", "urls[LinkedIn]": "linkedin", "urls[GitHub]": "github", "urls[Portfolio]": "portfolio" } },
    { name: "ashby", test: (h) => /ashbyhq\.com/.test(h),
      ids: { _systemfield_name: "fullName", _systemfield_email: "email" } },
    { name: "icims", test: (h) => /icims\.com/.test(h), ids: {} },
    { name: "smartrecruiters", test: (h) => /smartrecruiters\.com/.test(h), ids: {} },
  ];

  function adapterFor(host = location.hostname) {
    return ADAPTERS.find((a) => a.test(host)) || null;
  }

  function keyFromAdapter(adapter, el) {
    if (!adapter) return null;
    for (const attr of ["data-automation-id", "name", "id"]) {
      const v = el.getAttribute(attr);
      if (v && adapter.ids[v]) return adapter.ids[v];
    }
    return null;
  }

  NS.adapters = { adapterFor, keyFromAdapter, ADAPTERS };
})();
