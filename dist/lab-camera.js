"use strict";
const CropCamera = (() => {
  // Both the training set and the live camera use this radiometrically stylized crop scene.
  function frame(seed, ndvi, light = 1, size = 128, exposure = 0, station = false) {
    let state = seed >>> 0;
    function random() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    }
    const angle = -.55 + .33 * random(), spacing = .035 + .018 * random();
    const phase = random() * 6, cx = .27 + .46 * random(), cy = .27 + .46 * random();
    const rx = .11 + .10 * random(), ry = .12 + .11 * random();
    const biomass = Math.min(1, Math.max(0, (.55 - ndvi) / .24));
    const patch = ndvi < .515;
    // The five existing draws fix the plant geometry. Sample the building independently.
    const infrastructure = station ? {
      x:.16+.38*random(), y:.14+.46*random(), w:.24+.14*random(), h:.16+.10*random()
    } : null;
    state = (state + Math.imul(exposure, 2246822519)) >>> 0;
    const pixels = new Uint8ClampedArray(size * size * 3);
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const field = Math.sin(11*u + 8*v + phase) * Math.cos(8*v - 3*u + phase);
        const grain = random(), fleck = random();
        const row = (v + angle*u + .008*Math.sin(8*u + phase) + .006*(grain-.5)) / spacing;
        const furrow = Math.pow(.5 + .5*Math.cos(row*2*Math.PI), 3);
        const edge = 1 + .095*Math.sin(19*v+phase) + .1*Math.sin(23*u-8*v);
        const d = ((u-cx)/rx)**2 + ((v-cy)/ry)**2;
        const dry = patch ? Math.min(1, Math.max(0, (edge-d)*4)) * (.69 + .31*biomass) : 0;
        const value = (grain-.5)*19 + 8*field + (fleck>.94 ? 15 : 0) - 26*furrow;
        const i = 3*(y*size+x);
        pixels[i] = light*(57 + 63*dry + value + 9*furrow);
        pixels[i+1] = light*(95 + 12*dry + value);
        pixels[i+2] = light*(51 - 8*dry + value*.67);
        if(infrastructure) {
          const b=infrastructure;
          if(u>=b.x && u<=b.x+b.w && v>=b.y && v<=b.y+b.h) {
            const roof=(v-b.y)/b.h;
            const texture=(grain-.5)*11+(roof>.53 ? -20 : 10)+3*Math.sin((u-b.x)*480);
            pixels[i]=light*(105+texture); pixels[i+1]=light*(127+texture);
            pixels[i+2]=light*(138+texture);
          } else if(u>b.x+.01 && u<b.x+b.w+.011 && v>b.y+.02 && v<b.y+b.h+.018) {
            for(let c=0;c<3;c++) pixels[i+c]*=.58;
          }
        }
      }
    }
    return {pixels, size, label: patch ? {x:cx-rx, y:cy-ry, w:rx*2, h:ry*2} : null, infrastructure};
  }
  return {frame};
})();
if (typeof module !== "undefined" && module.exports) module.exports = CropCamera;
