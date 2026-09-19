const test = require('node:test');
const assert = require('node:assert/strict');
require('../../frontend/js/origin-country.js');
const country = globalThis.agraxCountryOf;
test('US states and multi-state origins group together', () => {
  for (const origin of ['California','Florida','New Mexico','Arizona-California','N Carolina-S Carolina','Washington-Oregon / COLUMBIA BASIN']) assert.equal(country(origin),'United States');
});
test('reported origin takes precedence over district or crossing text', () => {
  assert.equal(country('Canada / QUEBEC'),'Canada');
  assert.equal(country('Mexico / BAJA CALIFORNIA'),'Mexico');
  assert.equal(country('California / SOUTH DISTRICT CALIFORNIA AND MEXICO CROSSINGS'),'United States');
  assert.equal(country('Trinidad-Tobago'),'Trinidad and Tobago');
});
test('unknown origins are not guessed and country links round trip', () => {
  for (const origin of [null,'','Unknown district']) assert.equal(country(origin),'Not specified');
  for (const name of ['United States','Canada','Mexico','Fiji','Trinidad and Tobago','Not specified']) assert.equal(country(name),name);
});
