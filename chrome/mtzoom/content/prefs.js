/* global Components, document */

const { utils: Cu } = Components;
Cu.import("resource://gre/modules/Services.jsm");

const PREF_BRANCH = "extensions.mtzoom.";

function getBool(name, fallback) {
  try { return Services.prefs.getBoolPref(PREF_BRANCH + name); }
  catch (e) { return fallback; }
}

function setBool(name, value) {
  Services.prefs.setBoolPref(PREF_BRANCH + name, !!value);
}

function getNum(name, fallback) {
  // Use float pref if available; otherwise store as int tenths
  try {
    if (Services.prefs.getFloatPref) return Services.prefs.getFloatPref(PREF_BRANCH + name);
  } catch (e) {}
  try {
    return Services.prefs.getIntPref(PREF_BRANCH + name) / 10;
  } catch (e) {}
  return fallback;
}

function setNum(name, value) {
  const v = Number(value);
  if (!isFinite(v)) return;

  try {
    if (Services.prefs.setFloatPref) {
      Services.prefs.setFloatPref(PREF_BRANCH + name, v);
      return;
    }
  } catch (e) {}

  // Fallback: store in tenths as integer
  Services.prefs.setIntPref(PREF_BRANCH + name, Math.round(v * 10));
}

function speedToSlider(v) {
  // Your old UI used 0..10 step 1 with default 5 mapping to 0.7.
  // We keep: slider 0..10 => speed 0.0..1.4 in steps of 0.14
  const clamped = Math.max(0, Math.min(1.4, v));
  return Math.round((clamped / 1.4) * 10);
}

function sliderToSpeed(s) {
  const n = Number(s);
  const clamped = Math.max(0, Math.min(10, n));
  return (clamped / 10) * 1.4;
}

function updateSpeedLabel(sliderVal) {
  const speed = sliderToSpeed(sliderVal);
  document.getElementById("mtzoom_speed_value").value = speed.toFixed(2);
}

function restore() {
  document.getElementById("mtzoom_shiftkey").checked = getBool("shiftKeyZoom", true);
  document.getElementById("mtzoom_disableScrollbarsWhenZooming").checked =
    getBool("disableScrollbarsWhenZooming", false);

  const speed = getNum("pinchZoomSpeed", 0.7);
  const sliderVal = speedToSlider(speed);

  const slider = document.getElementById("mtzoom_speed");
  slider.value = sliderVal;
  updateSpeedLabel(sliderVal);
}

function bind() {
  document.getElementById("mtzoom_shiftkey").addEventListener("command", function (e) {
    setBool("shiftKeyZoom", e.target.checked);
  });

  document.getElementById("mtzoom_disableScrollbarsWhenZooming").addEventListener("command", function (e) {
    setBool("disableScrollbarsWhenZooming", e.target.checked);
  });

  const slider = document.getElementById("mtzoom_speed");
  slider.addEventListener("command", function () {
    updateSpeedLabel(slider.value);
    setNum("pinchZoomSpeed", sliderToSpeed(slider.value));
  });
}

document.addEventListener("DOMContentLoaded", function () {
  restore();
  bind();
});
