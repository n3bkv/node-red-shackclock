"use strict";

const fs = require("fs");

const SETTINGS = process.env.SHACKCLOCK_SETTINGS_FILE || "/data/shackclock-settings.json";
const OLD_PRIMARY = "https://www.dxsummit.fi/api/v1/spots?content_type=csv&limit=100";
const NEW_PRIMARY = "http://www.dxsummit.fi/api/v1/spots?content_type=csv&limit=100";
const OLD_FALLBACK = "https://www.dxsummit.fi/text/dx100.html";
const NEW_FALLBACK = "http://www.dxsummit.fi/text/dx100.html";

if (!fs.existsSync(SETTINGS)) process.exit(0);

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
} catch (e) {
  console.warn(`[ShackClock] DX Summit URL migration skipped: ${e.message}`);
  process.exit(0);
}

let changed = false;
if (cfg.DX_SUMMIT_URL === OLD_PRIMARY) {
  cfg.DX_SUMMIT_URL = NEW_PRIMARY;
  changed = true;
}
if (cfg.DX_SUMMIT_FALLBACK_URL === OLD_FALLBACK) {
  cfg.DX_SUMMIT_FALLBACK_URL = NEW_FALLBACK;
  changed = true;
}

if (changed) {
  fs.writeFileSync(SETTINGS, JSON.stringify(cfg, null, 2) + "\n");
  console.log("[ShackClock] migrated saved DX Summit URLs from HTTPS to HTTP for v1.1.1");
}
