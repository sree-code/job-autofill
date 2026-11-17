import "zone.js";
import "@angular/compiler";
import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { ReactiveFormsModule, FormBuilder } from "@angular/forms";
import { inject } from "@angular/core";

const AppComponent = Component({
  selector: "app-root",
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
  <form [formGroup]="form">
    <h1>Angular application</h1>
    <label for="fn">First Name</label><input id="fn" formControlName="firstName">
    <label for="ln">Last Name</label><input id="ln" formControlName="lastName">
    <label for="em">Email Address</label><input id="em" formControlName="email">
    <label for="ph">Mobile phone</label><input id="ph" formControlName="phone">
    <label for="st">State / Province</label>
    <select id="st" formControlName="state"><option value="">Select</option><option value="CA">California</option><option value="TX">Texas</option></select>
    <fieldset><legend>Will you require visa sponsorship?</legend>
      <label><input type="radio" formControlName="sponsor" value="yes"> Yes</label>
      <label><input type="radio" formControlName="sponsor" value="no"> No</label></fieldset>
    <label for="why">Why do you want to work here?</label><textarea id="why" formControlName="why"></textarea>
  </form>`,
})(class {
  form = inject(FormBuilder).group({ firstName: [""], lastName: [""], email: [""], phone: [""], state: [""], sponsor: [""], why: [""] });
  constructor() { window.appState = () => ({ ...this.form.value, dirty: this.form.dirty }); }
});
bootstrapApplication(AppComponent);
