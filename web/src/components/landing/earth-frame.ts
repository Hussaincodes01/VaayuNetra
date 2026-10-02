// Framing of the hero Earth (kept out of HeroEarth.tsx so the page can use it without loading three.js).
// The posters in public/hero/ are this scene's first frame: earth-poster.webp with EARTH_LIFT (desktop),
// earth-poster-phone.webp with lift 0. Re-capture both when the framing changes.

/** Camera distance and vertical field of view at the hero's first frame. */
export const EARTH_CAMERA = { z: 3.9, fov: 35 };

/** Desktop camera height above the globe's centre: drops the globe into the cloud bank. */
export const EARTH_LIFT = 0.3;
