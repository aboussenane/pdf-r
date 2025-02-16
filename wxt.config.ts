import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    manifest_version: 3,
    name: "Webpage to PDF",
    version: "1.0",
    description: "Capture a webpage screenshot and save it as a PDF",
    permissions: ["tabs", "activeTab", "downloads", "scripting"],
    background: {
      service_worker: "background.ts",
    },
    action: {
      default_popup: "popup.html",
    }
  },
});
