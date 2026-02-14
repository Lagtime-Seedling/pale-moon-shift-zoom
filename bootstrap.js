/* global Components */

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");

const ADDON_ID = "multi-touch-zoom@lagtime.seedling";
const PREF_BRANCH = "extensions.mtzoom.";

let gmm = null;
let prefObserverRegistered = false;

function readPrefs() {
  return {
    shiftKeyZoom: Services.prefs.getBoolPref(PREF_BRANCH + "shiftKeyZoom", true),
    pinchZoomSpeed: Services.prefs.getFloatPref
      ? Services.prefs.getFloatPref(PREF_BRANCH + "pinchZoomSpeed", 0.7)
      : Services.prefs.getIntPref(PREF_BRANCH + "pinchZoomSpeed", 1) / 10,
    disableScrollbarsWhenZooming: Services.prefs.getBoolPref(
      PREF_BRANCH + "disableScrollbarsWhenZooming",
      false
    ),
  };
}

function broadcastPrefs() {
  if (!gmm) return;
  gmm.broadcastAsyncMessage("mtzoom:prefs", readPrefs());
}

const prefObserver = {
  observe(subject, topic, data) {
    if (topic !== "nsPref:changed") return;
    // Any change under our branch => re-broadcast
    broadcastPrefs();
  },
};

function ensureGMM() {
  if (gmm) return;

  // Global message manager (single-process still supports this interface)
  gmm = Cc["@mozilla.org/globalmessagemanager;1"].getService(Ci.nsIMessageListenerManager);

  // Load our frame script into all current + future frames
  gmm.loadFrameScript("chrome://mtzoom/content/frame-script.js", true);

  // Push current prefs once loaded
  broadcastPrefs();
}

function registerPrefObserver() {
  if (prefObserverRegistered) return;
  Services.prefs.addObserver(PREF_BRANCH, prefObserver, false);
  prefObserverRegistered = true;
}

function unregisterPrefObserver() {
  if (!prefObserverRegistered) return;
  Services.prefs.removeObserver(PREF_BRANCH, prefObserver);
  prefObserverRegistered = false;
}

function startup(data, reason) {
  ensureGMM();
  registerPrefObserver();
}

function shutdown(data, reason) {
  // APP_SHUTDOWN means the browser is closing; no cleanup needed.
  if (reason === APP_SHUTDOWN) return;

  unregisterPrefObserver();

  // Tell frame scripts to disable/cleanup
  if (gmm) {
    gmm.broadcastAsyncMessage("mtzoom:shutdown", {});
  }

  gmm = null;
}

function install(data, reason) {}
function uninstall(data, reason) {}
