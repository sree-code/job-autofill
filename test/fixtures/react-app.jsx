import React, { useState } from "react";
import { createRoot } from "react-dom/client";
function App() {
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", phone: "", state: "", auth: "", why: "", adult: "" });
  window.appState = () => f;
  const on = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form>
      <h1>React application</h1>
      <label htmlFor="fn">First name</label><input id="fn" value={f.firstName} onChange={on("firstName")} />
      <label htmlFor="ln">Last name</label><input id="ln" value={f.lastName} onChange={on("lastName")} />
      <label htmlFor="em">Email</label><input id="em" type="email" value={f.email} onChange={on("email")} />
      <label htmlFor="ph">Phone</label><input id="ph" value={f.phone} onChange={on("phone")} />
      <label htmlFor="st">State</label>
      <select id="st" value={f.state} onChange={on("state")}><option value="">Select…</option><option value="CA">California</option><option value="TX">Texas</option></select>
      <fieldset><legend>Are you legally authorized to work in the US?</legend>
        <label><input type="radio" name="auth" value="yes" checked={f.auth === "yes"} onChange={on("auth")} /> Yes</label>
        <label><input type="radio" name="auth" value="no" checked={f.auth === "no"} onChange={on("auth")} /> No</label></fieldset>
      <label htmlFor="ad">Are you at least 18 years of age?</label>
      <select id="ad" value={f.adult} onChange={on("adult")}><option value="">Select…</option><option>Yes</option><option>No</option></select>
      <label htmlFor="why">Why do you want to work here?</label><textarea id="why" value={f.why} onChange={on("why")} />
    </form>
  );
}
createRoot(document.getElementById("root")).render(<App />);
