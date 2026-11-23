"use strict";

const CameraFeed = (() => {
  const size = 128;
  const parcel = 100;
  const columns = 6;
  const rows = "ABCD";

  function sample(frame, u, v, irradiance, target, offset) {
    const last = frame.size - 1;
    const x = Math.max(0, Math.min(last, u * frame.size - 0.5));
    const y = Math.max(0, Math.min(last, v * frame.size - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const dx = x - x0, dy = y - y0;
    const a = 3 * (y0 * frame.size + x0);
    const b = x0 < last ? a + 3 : a;
    const stride = y0 < last ? frame.size * 3 : 0;
    const pixels = frame.pixels;
    for (let ch = 0; ch < 3; ch++) {
      const upper = pixels[a + ch] + dx * (pixels[b + ch] - pixels[a + ch]);
      const lower = pixels[a + stride + ch] + dx * (pixels[b + stride + ch] - pixels[a + stride + ch]);
      target[offset + ch] = irradiance * (upper + dy * (lower - upper));
    }
  }

  function render(observation, seconds, position = null, tileFor = null) {
    if (!observation?.available || !observation.frame) {
      throw new RangeError("Для видеопотока требуется доступный кадр.");
    }
    const flying = position !== null;
    if (flying && typeof tileFor !== "function") {
      throw new TypeError("Для обзора соседних секторов требуется карта кадров.");
    }
    // The fixed camera inspects one whole parcel. The moving camera sees an
    // 80 × 42 m footprint, with north at the top of the displayed image.
    const width = flying ? 80 : parcel;
    const height = flying ? 42 : parcel;
    const left = flying ? position.x - width / 2 : 0;
    const top = flying ? 400 - position.y - height / 2 : 0;
    const pixels = new Uint8ClampedArray(size * size * 3);
    const tiles = new Array(columns * rows.length);
    const columnAt = new Int8Array(size);
    const uAt = new Float32Array(size);
    const xWave = new Float32Array(size);
    const xRipple = new Float32Array(size);
    for (let x = 0; x < size; x++) {
      const east = left + width * (x + 0.5) / size;
      const col = Math.floor(east / parcel);
      columnAt[x] = col;
      uAt[x] = east / parcel - col;
      xWave[x] = Math.sin(east * 0.067 - seconds * 1.8);
      xRipple[x] = Math.cos(east * 0.13 + seconds * 1.12);
    }
    for (let y = 0; y < size; y++) {
      const south = top + height * (y + 0.5) / size;
      const row = Math.floor(south / parcel);
      const v = south / parcel - row;
      const yWave = Math.sin(south * 0.073 + seconds * 1.56);
      const yRipple = Math.cos(south * 0.12 - seconds * 0.93);
      for (let x = 0; x < size; x++) {
        const index = 3 * (y * size + x);
        const col = columnAt[x];
        if (col < 0 || col >= columns || row < 0 || row >= rows.length) {
          pixels[index] = 28;
          pixels[index + 1] = 37;
          pixels[index + 2] = 31;
          continue;
        }
        let frame = observation.frame;
        if (flying) {
          const tileIndex = row * columns + col;
          if (tiles[tileIndex] === undefined) {
            const id = rows[row] + (col + 1);
            const tile = id === observation.cell ? observation : tileFor(id);
            tiles[tileIndex] = tile?.available ? tile.frame : null;
          }
          frame = tiles[tileIndex];
        }
        if (!frame) {
          const stripe = (y % 6 < 2) ? 7 : 0;
          pixels[index] = 16 + stripe;
          pixels[index + 1] = 27 + stripe;
          pixels[index + 2] = 31 + stripe;
          continue;
        }
        // A travelling gust bends different rows by different amounts while the
        // larger features (parcel boundaries and crop patches) stay in place.
        const gust = xWave[x] * yWave;
        const u = uAt[x] + 0.009 * gust + 0.004 * yRipple;
        const vv = v + 0.014 * gust + 0.006 * xRipple[x] * yRipple;
        const irradiance = 1 + 0.044 * gust + 0.015 * xRipple[x] * yWave;
        sample(frame, u, vv, irradiance, pixels, index);
      }
    }
    return {size, pixels};
  }

  return {render};
})();

if (typeof module !== "undefined" && module.exports) module.exports = CameraFeed;
