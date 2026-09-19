/* Country facets for USDA terminal origins. Preserve the original origin on quotes. */
(function (root) {
  'use strict';
  var states = ('Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia|Puerto Rico|N Carolina|S Carolina').toLowerCase().split('|');
  var countries = ('Argentina|Australia|Belgium|Belize|Brazil|Canada|Chile|China|Colombia|Costa Rica|Dominican Republic|Ecuador|Egypt|Fiji|France|Ghana|Guatemala|Honduras|India|Israel|Italy|Jamaica|Japan|Mexico|Morocco|Netherlands|New Zealand|Nicaragua|Palestinian Territory|Panama|Peru|South Africa|Spain|Thailand|Trinidad and Tobago|Tunisia|United States|Uruguay|Vietnam').split('|');
  var names = {};
  countries.forEach(function (country) { names[country.toLowerCase()] = country; });
  names['fiji islands'] = 'Fiji';
  names['trinidad-tobago'] = 'Trinidad and Tobago';
  ['usa', 'us', 'u.s.', 'u.s.a.'].forEach(function (name) { names[name] = 'United States'; });
  function countryOf(origin) {
    // The first component is the reported origin; the suffix is a district,
    // which can mention border crossings and must not override that origin.
    var value = String(origin || '').split(/\s*\/\s*/)[0].trim().toLowerCase();
    if (names[value]) return names[value];
    if (value && value.split('-').every(function (part) { return states.indexOf(part.trim()) !== -1; })) return 'United States';
    return 'Not specified';
  }
  root.agraxCountryOf = countryOf;
})(typeof window !== 'undefined' ? window : globalThis);
