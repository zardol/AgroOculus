"use strict";
const Instruments = (() => {
  const symbols = {
    data: '<path d="m9 18 19-9 22 8-20 10zM9 18v15l21 9 20-11V17M30 27v15M14 24l10 4"/><path d="m40 13 6-5 9 4-5 5"/><ellipse cx="40" cy="29" rx="5" ry="7" transform="rotate(23 40 29)"/><path d="m40 6 5-3 8 3"/>',
    route:
      '<path d="m6 35 10 5 15-9 13 4 13-7M8 28l11-7 12 5 13-14 9 4" stroke-dasharray="3 4"/><circle cx="8" cy="28" r="3"/><circle cx="31" cy="26" r="3"/><path d="M50 9c0-7 10-7 10 0 0 4-5 9-5 9s-5-5-5-9z"/><circle cx="55" cy="8" r="1.3"/><path d="m11 39-5 3m22-7-5 3"/>',
    flight:
      '<path d="m23 19-7-5m24 5 7-5m-24 14-8 5m25-5 7 4"/><path d="m23 18 9-5 10 6-3 11-8 4-8-7z"/><path d="m26 21 6-3 6 3-5 5z"/><g transform="rotate(-12 32 24)"><ellipse cx="13" cy="11" rx="10" ry="5"/><ellipse cx="51" cy="17" rx="10" ry="5"/><ellipse cx="12" cy="31" rx="10" ry="5"/><ellipse cx="48" cy="36" rx="10" ry="5"/></g>',
    detection:
      '<path d="M8 17V7h13m22 0h13v10M8 31v10h13m22 0h13V31"/><path d="m20 31 9-7 5-14 6 12-7 9z"/><path d="m26 34 9-13"/><path d="M14 24h7m24 0h6M32 4v4m0 31v5" opacity=".6"/>',
    map: '<path d="m5 26 25 13 28-14M5 32l25 13 28-14" opacity=".65"/><path d="m5 20 24-14 29 13-28 15z"/><path d="m18 13 11 6 8-2 9 5m-29-1 9-1 3 7"/>',
    coordinates:
      '<path d="M18 32V7m0 25 31 5m-31-5 18-18m-21-4 3-5 4 7m23 20 6 5-7 3m-13-25 7-2-2 7"/><path d="m29 28 11 2 7-7-10-2zM33 30l1 5m12-12v7" stroke-dasharray="2 3"/><circle cx="18" cy="32" r="3"/>',
    decision:
      '<path d="m31 6 10 7-10 7-10-7zM31 20v5m0 0H13v7m18-7h18v7"/><rect x="6" y="32" width="14" height="9" rx="1"/><rect x="42" y="32" width="14" height="9" rx="1"/><path d="m44 37 3 1 5-4"/>',
  };
  const icons = {
    scheme:
      '<rect x="8" y="2" width="5" height="5" rx="1"/><rect x="2" y="14" width="5" height="5" rx="1"/><rect x="14" y="14" width="5" height="5" rx="1"/><path d="M10.5 7v3.5m-6 3.5v-3.5h12V14"/>',
    play: '<path d="m6 3 12 7-12 7z"/>',
    pause: '<path d="M7 4v12m6-12v12" stroke-width="3"/>',
    manual: '<path d="m4 2 12 9-6 1-3 5z"/>',
    pin: '<path d="M4 8a6 6 0 1 1 12 0c0 4-6 10-6 10S4 12 4 8z"/><circle cx="10" cy="8" r="2"/>',
    sensor: '<path d="M1 11h4l3-7 4 13 3-8 2 2h3"/>',
    camera:
      '<rect x="2" y="6" width="13" height="10" rx="2"/><path d="m15 9 4-3v10l-4-3"/>',
    next: '<path d="m8 4 6 6-6 6"/>',
    cycle: '<path d="M16 6a7 7 0 1 0 1 7M16 2v5h-5"/>',
    log: '<path d="m2 5 5 5-5 5m8 1h8"/>',
    report: '<path d="M4 2h9l4 4v13H4zM12 2v5h5M7 11h7m-7 4h5"/>',
  };
  function icon(name) {
    return (
      '<svg class="ico" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">' +
      icons[name] +
      "</svg>"
    );
  }
  function art(name) {
    return (
      '<svg class="symbol" aria-hidden="true" viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">' +
      symbols[name] +
      "</svg>"
    );
  }
  return { icon, art };
})();
