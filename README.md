# PDF.js generic viewer source

This is a reduced PDF.js source tree for building the generic web viewer. It retains the PDF parsing, rendering, scripting, viewer, localization, and runtime resources needed for two builds:

```bash
npm install
npx gulp generic
npx gulp generic-legacy
```

The outputs are `build/generic/` and `build/generic-legacy/`. Each contains `web/viewer.html`, JavaScript bundles, localization files, fonts, CMaps, ICC profiles, and WASM resources. Serve either output directory over HTTP and open `web/viewer.html`.

Run the build tasks one at a time because they share temporary files. The `build/` directory and `web/locale/` are generated and can be deleted before rebuilding.

The original PDF.js project is maintained by Mozilla at https://github.com/mozilla/pdf.js. See [LICENSE](LICENSE) and the licenses under `external/` for licensing information.
