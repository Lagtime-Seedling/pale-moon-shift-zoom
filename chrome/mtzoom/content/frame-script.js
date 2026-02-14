/* global Components */

(function () {
  const { utils: Cu } = Components;
  Cu.import("resource://gre/modules/Services.jsm");

  // Prevent double-install per content window
  if (content && content.wrappedJSObject && content.wrappedJSObject.__mtzoomFrameScriptLoaded) {
    return;
  }
  try {
    content.wrappedJSObject.__mtzoomFrameScriptLoaded = true;
  } catch (e) {
    // If wrappedJSObject unavailable for some reason, continue without flag.
  }

  // Settings (fed from bootstrap via async messages)
  let shiftKeyZoom = true;
  let pinchZoomSpeed = 0.7;
  let disableScrollbarsWhenZooming = false;

  // view scaling parameters and other options (from your original file)
  const scaleMode = 1; // 0 = always high quality, 1 = low-quality while zooming
  const minScale = 1.0;
  const maxScale = 10;
  const zoomSpeedMultiplier = 0.03 / 5;
  const overflowTimeout_ms = 400;
  const highQualityWait_ms = 40;
  const alwaysHighQuality = false;

  // pan feature variables
  let horizontalOriginShift = 0; // > 0 to the right,  < 0 to the left
  let verticalOriginShift = 0; // > 0 down, < 0 up

  // state
  let pageScale = 1;
  let translationX = 0;
  let translationY = 0;
  let overflowTranslationX = 0;
  let overflowTranslationY = 0;

  // pan state
  let mouseX, mouseY;
  let shoudFollowMouse = false;
  let canFollowMouse = false;

  // elements (per-document)
  let pageElement = null;
  let wheelEventElement = null;
  let scrollEventElement = null;

  // because scroll top/left are handled as integers only
  let ignoredScrollLeft = null;
  let ignoredScrollTop = null;

  let controlDisabled = false;
  let qualityTimeoutHandle = null;
  let overflowTimeoutHandle = null;

  function getScrollBoxElement(doc) {
    return doc.documentElement || doc.body;
  }

  function updateTranslationFromScroll(doc) {
    const scrollBox = getScrollBoxElement(doc);
    if (!scrollBox) return;

    if (scrollBox.scrollLeft !== ignoredScrollLeft) {
      translationX = -scrollBox.scrollLeft;
      ignoredScrollLeft = null;
    }
    if (scrollBox.scrollTop !== ignoredScrollTop) {
      translationY = -scrollBox.scrollTop;
      ignoredScrollTop = null;
    }
  }

  function disableControl() {
    if (controlDisabled) return;
    if (!pageElement) return;

    if (disableScrollbarsWhenZooming) {
      const verticalScrollBarWidth = content.innerWidth - pageElement.clientWidth;
      const horizontalScrollBarWidth = content.innerHeight - pageElement.clientHeight;

      pageElement.style.setProperty("overflow", "hidden", "important");
      pageElement.style.setProperty("margin-right", verticalScrollBarWidth + "px", "important");
      pageElement.style.setProperty("margin-bottom", horizontalScrollBarWidth + "px", "important");
    }

    controlDisabled = true;
  }

  function restoreControl() {
    if (!controlDisabled) return;
    if (!pageElement) return;

    pageElement.style.overflow = "auto";
    pageElement.style.marginRight = "";
    pageElement.style.marginBottom = "";
    controlDisabled = false;
  }

  function updateTransform(scaleModeOverride, shouldDisableControl) {
    if (!pageElement) return;

    if (shouldDisableControl == null) shouldDisableControl = true;

    const sm = scaleModeOverride == null ? scaleMode : scaleModeOverride;

    if (sm === 0 || alwaysHighQuality) {
      pageElement.style.setProperty("transform", `scaleX(${pageScale}) scaleY(${pageScale})`, "important");
    } else {
      const p = 1;
      const z = p - p / pageScale;

      pageElement.style.setProperty("transform", `perspective(${p}px) translateZ(${z}px)`, "important");

      content.clearTimeout(qualityTimeoutHandle);
      qualityTimeoutHandle = content.setTimeout(function () {
        if (!pageElement) return;
        pageElement.style.setProperty("transform", `scaleX(${pageScale}) scaleY(${pageScale})`, "important");
      }, highQualityWait_ms);
    }

    pageElement.style.setProperty(
      "transform-origin",
      `${horizontalOriginShift}px ${verticalOriginShift}px`,
      "important"
    );

    pageElement.style.position = "relative";
    pageElement.style.height = "100%";

    if (minScale < 1) {
      pageElement.style.setProperty(
        "left",
        `${Math.max(translationX, 0) - overflowTranslationX}px`,
        "important"
      );
      pageElement.style.setProperty(
        "top",
        `${Math.max(translationY, 0) - overflowTranslationY}px`,
        "important"
      );
    }

    pageElement.style.transitionProperty = "transform, left, top";
    pageElement.style.transitionDuration = "0s";

    if (shouldDisableControl) {
      disableControl();
      content.clearTimeout(overflowTimeoutHandle);
      overflowTimeoutHandle = content.setTimeout(function () {
        restoreControl();
      }, overflowTimeout_ms);
    }
  }

  function applyScale(doc, scaleBy, x_scrollBoxElement, y_scrollBoxElement) {
    const scrollBox = getScrollBoxElement(doc);
    if (!scrollBox) return;

    function setTranslationX(v) {
      v = Math.min(v, 0);
      v = Math.max(v, -(scrollBox.scrollWidth - scrollBox.clientWidth));

      translationX = v;

      scrollBox.scrollLeft = Math.max(-v, 0);
      ignoredScrollLeft = scrollBox.scrollLeft;

      overflowTranslationX =
        v < 0 ? Math.max((-v) - (scrollBox.scrollWidth - scrollBox.clientWidth), 0) : 0;
    }

    function setTranslationY(v) {
      v = Math.min(v, 0);
      v = Math.max(v, -(scrollBox.scrollHeight - scrollBox.clientHeight));

      translationY = v;

      scrollBox.scrollTop = Math.max(-v, 0);
      ignoredScrollTop = scrollBox.scrollTop;

      overflowTranslationY =
        v < 0 ? Math.max((-v) - (scrollBox.scrollHeight - scrollBox.clientHeight), 0) : 0;
    }

    const pageScaleBefore = pageScale;
    pageScale *= scaleBy;
    pageScale = Math.min(Math.max(pageScale, minScale), maxScale);
    const effectiveScale = pageScale / pageScaleBefore;

    if (pageScale === 1) {
      canFollowMouse = false;
    } else {
      canFollowMouse = true;
    }

    if (pageScale === 1 && (horizontalOriginShift || verticalOriginShift)) {
      horizontalOriginShift = 0;
      verticalOriginShift = 0;
    }

    if (effectiveScale === 1) return;

    updateTransform(null, null);

    const zx = x_scrollBoxElement;
    const zy = y_scrollBoxElement;

    let tx = translationX;
    tx = (tx - zx) * effectiveScale + zx;

    let ty = translationY;
    ty = (ty - zy) * effectiveScale + zy;

    setTranslationX(tx);
    setTranslationY(ty);

    updateTransform(null, null);
  }

  function resetScale(doc) {
    const scrollBox = getScrollBoxElement(doc);
    if (!scrollBox) return;

    pageScale = 1;
    translationX = 0;
    translationY = 0;
    overflowTranslationX = 0;
    overflowTranslationY = 0;

    horizontalOriginShift = 0;
    verticalOriginShift = 0;

    const scrollLeftBefore = scrollBox.scrollLeft;
    const scrollTopBefore = scrollBox.scrollTop;

    updateTransform(0, false);

    // Restore scroll proportionally (best effort)
    try {
      scrollBox.scrollLeft = scrollLeftBefore;
      scrollBox.scrollTop = scrollTopBefore;
    } catch (e) {}

    updateTranslationFromScroll(doc);

    pageElement.style.overflow = "";
  }

  function attachToDocument(doc) {
    if (!doc || !doc.defaultView) return;

    // Only HTML docs
    const isHTML = doc.contentType && doc.contentType.indexOf("text/html") === 0;
    if (!isHTML) return;

    // Avoid double-attach
    if (doc.__mtzoomAttached) return;
    doc.__mtzoomAttached = true;

    // Reset per-document element handles
    pageElement = doc.documentElement;
    wheelEventElement = doc.documentElement;
    scrollEventElement = doc.defaultView;

    if (!pageElement) return;

    const scrollBox = getScrollBoxElement(doc);
    if (!scrollBox) return;

    // Mouse movement tracking for pan feature
    doc.addEventListener(
      "mousemove",
      function (e) {
        if (!canFollowMouse) return;
        if (shoudFollowMouse && mouseX != null && mouseY != null) {
          horizontalOriginShift += e.clientX - mouseX;
          verticalOriginShift += e.clientY - mouseY;
          pageElement.style.setProperty(
            "transform-origin",
            `${horizontalOriginShift}px ${verticalOriginShift}px`,
            "important"
          );
        }
        mouseX = e.clientX;
        mouseY = e.clientY;
      },
      true
    );

    // ctrl + 0 to reset zoom
    doc.defaultView.addEventListener(
      "keydown",
      function (e) {
        if (e.key === "0" && e.ctrlKey) {
          resetScale(doc);
          return;
        }
        shoudFollowMouse = !!e.shiftKey;
      },
      true
    );

    doc.defaultView.addEventListener(
      "keyup",
      function (e) {
        shoudFollowMouse = !!e.shiftKey;
      },
      true
    );

    // Keep translation in sync
    scrollEventElement.addEventListener(
      "scroll",
      function () {
        updateTranslationFromScroll(doc);
      },
      { capture: false, passive: false }
    );

    wheelEventElement.addEventListener(
      "wheel",
      function (e) {
        if (e.shiftKey && shiftKeyZoom) {
          if (e.defaultPrevented) return;

          const x = e.clientX - scrollBox.offsetLeft;
          const y = e.clientY - scrollBox.offsetTop;

          const deltaMultiplier = pinchZoomSpeed * zoomSpeedMultiplier;

          const newScale = pageScale + e.deltaY * deltaMultiplier;
          const scaleBy = pageScale / newScale;

          applyScale(doc, scaleBy, x, y);

          e.preventDefault();
          e.stopPropagation();
        } else {
          restoreControl();
        }
      },
      { capture: false, passive: false }
    );

    scrollBox.addEventListener("mousemove", restoreControl, true);
    scrollBox.addEventListener("mousedown", restoreControl, true);
  }

  // Attach on each top-level document load
  function onLoad(event) {
    try {
      const doc = event.originalTarget;
      if (!doc || !doc.defaultView) return;

      // Only top-level (not every iframe)
      if (doc.defaultView !== content) return;

      attachToDocument(doc);
    } catch (e) {}
  }

  // Listen for preferences from bootstrap.js
  addMessageListener("mtzoom:prefs", function (msg) {
    if (!msg || !msg.data) return;
    if (typeof msg.data.shiftKeyZoom === "boolean") shiftKeyZoom = msg.data.shiftKeyZoom;
    if (typeof msg.data.pinchZoomSpeed === "number") pinchZoomSpeed = msg.data.pinchZoomSpeed;
    if (typeof msg.data.disableScrollbarsWhenZooming === "boolean") {
      disableScrollbarsWhenZooming = msg.data.disableScrollbarsWhenZooming;
    }
  });

  addMessageListener("mtzoom:shutdown", function () {
    // Best-effort cleanup in current doc
    try {
      const doc = content.document;
      if (doc) resetScale(doc);
    } catch (e) {}
  });

  addEventListener("load", onLoad, true);

  // If a document is already loaded when the frame script lands:
  try {
    if (content.document && content.document.readyState) {
      attachToDocument(content.document);
    }
  } catch (e) {}
})();
