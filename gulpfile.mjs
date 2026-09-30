/* Copyright 2016 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { babelPluginPDFJSPreprocessor } from "./external/builder/babel-plugin-pdfjs-preprocessor.mjs";
import { exec } from "child_process";
import autoprefixer from "autoprefixer";
import crypto from "crypto";
import fs from "fs";
import gulp from "gulp";
import ordered from "ordered-read-streams";
import path from "path";
import postcss from "gulp-postcss";
import postcssDiscardComments from "postcss-discard-comments";
import { preprocess } from "./external/builder/builder.mjs";
import stream from "stream";
import Vinyl from "vinyl";
import webpack2 from "webpack";
import webpackStream from "webpack-stream";

const __dirname = import.meta.dirname;
const BUILD_DIR = "build/";
const L10N_DIR = "l10n/";
const GENERIC_DIR = BUILD_DIR + "generic/";
const GENERIC_LEGACY_DIR = BUILD_DIR + "generic-legacy/";
const TMP_DIR = BUILD_DIR + "tmp/";
const COMMON_WEB_FILES = ["web/images/*.{png,svg,gif}", "web/debugger.{css,mjs}"];
const config = JSON.parse(fs.readFileSync("pdfjs.config"));
const ENV_TARGETS = [
  "last 2 versions", "Chrome >= 125", "Firefox ESR", "Safari >= 18",
  "Node >= 22", "> 1%", "not IE > 0", "not dead",
];
const AUTOPREFIXER_CONFIG = { overrideBrowserslist: ENV_TARGETS };
const BABEL_TARGETS = ENV_TARGETS.join(", ");
const BABEL_COREJS_OPTS = Object.freeze({
  method: "usage-global", version: "3.50.0",
  exclude: ["web.structured-clone"], shippedProposals: true,
});
const DEFINES = Object.freeze({
  SKIP_BABEL: true, WORKER_THREAD: false, TESTING: undefined,
  COVERAGE: undefined, INTERNAL_EVT: crypto.randomUUID(),
  GENERIC: false, MOZCENTRAL: false, GECKOVIEW: false, CHROME: false,
  MINIFIED: false, COMPONENTS: false, LIB: false, IMAGE_DECODERS: false,
  INTERNAL_VIEWER: false,
});

function createStringSource(filename, content) {
  const source = stream.Readable({ objectMode: true });
  source._read = function () {
    this.push(
      new Vinyl({
        path: filename,
        contents: Buffer.from(content),
      })
    );
    this.push(null);
  };
  return source;
}


function createWebpackAlias() {
  const alias = {
    pdfjs: "src",
    "pdfjs-web": "web",
    "pdfjs-lib": "web/pdfjs",
    "fluent-bundle": "node_modules/@fluent/bundle/esm/index.js",
    "fluent-dom": "node_modules/@fluent/dom/esm/index.js",
    "display-binary_data_factory": "src/display/binary_data_factory.js",
    "display-network_stream": "src/display/network_stream.js",
    "display-node_utils": "src/display/node_utils.js",
    "web-alt_text_manager": "web/alt_text_manager.js",
    "web-annotation_editor_params": "web/annotation_editor_params.js",
    "web-download_manager": "web/download_manager.js",
    "web-external_services": "web/genericcom.js",
    "web-new_alt_text_manager": "web/new_alt_text_manager.js",
    "web-null_l10n": "web/genericl10n.js",
    "web-pdf_attachment_viewer": "web/pdf_attachment_viewer.js",
    "web-pdf_cursor_tools": "web/pdf_cursor_tools.js",
    "web-pdf_document_properties": "web/pdf_document_properties.js",
    "web-pdf_find_bar": "web/pdf_find_bar.js",
    "web-pdf_layer_viewer": "web/pdf_layer_viewer.js",
    "web-pdf_outline_viewer": "web/pdf_outline_viewer.js",
    "web-pdf_presentation_mode": "web/pdf_presentation_mode.js",
    "web-pdf_thumbnail_viewer": "web/pdf_thumbnail_viewer.js",
    "web-preferences": "web/genericcom.js",
    "web-print_service": "web/pdf_print_service.js",
    "web-secondary_toolbar": "web/secondary_toolbar.js",
    "web-signature_manager": "web/signature_manager.js",
    "web-digital_signature_properties_manager":
      "web/digital_signature_properties_manager.js",
    "web-toolbar": "web/toolbar.js",
    "web-views_manager": "web/views_manager.js",
  };
  for (const key in alias) {
    alias[key] = path.join(__dirname, alias[key]);
  }
  return alias;
}

function createWebpackConfig(
  defines,
  output,
  {
    disableVersionInfo = false,
    disableSourceMaps = false,
    disableLicenseHeader = false,
  } = {}
) {
  const versionInfo = !disableVersionInfo
    ? getVersionJSON()
    : { version: 0, commit: 0 };
  const bundleDefines = {
    ...defines,
    BUNDLE_VERSION: versionInfo.version,
    BUNDLE_BUILD: versionInfo.commit,
    TESTING: defines.TESTING ?? process.env.TESTING === "true",
    COVERAGE: false,
    DEFAULT_FTL: defines.GENERIC ? getDefaultFtl() : "",
  };
  const licenseHeaderLibre = fs
    .readFileSync("./src/license_header_libre.js")
    .toString();
  const versionInfoHeader = [
    "/**",
    ` * pdfjsVersion = ${versionInfo.version}`,
    ` * pdfjsBuild = ${versionInfo.commit}`,
    " */",
  ].join("\n");
  const enableSourceMaps =
    !bundleDefines.MOZCENTRAL &&
    !bundleDefines.CHROME &&
    !bundleDefines.LIB &&
    !bundleDefines.MINIFIED &&
    (!bundleDefines.TESTING || bundleDefines.COVERAGE) &&
    !disableSourceMaps;
  const isModule = output.library?.type === "module";
  const skipBabel = bundleDefines.SKIP_BABEL;

  const babelExcludeRegExp = [
    // `core-js`, see https://github.com/zloirock/core-js/issues/514,
    // should be excluded from processing.
    /node_modules[\\/]core-js/,
  ];

  const babelPresets = skipBabel ? undefined : ["@babel/preset-env"];
  const babelPlugins = [
    [
      babelPluginPDFJSPreprocessor,
      {
        rootPath: __dirname,
        defines: bundleDefines,
      },
    ],
  ];
  if (!skipBabel) {
    babelPlugins.push(["babel-plugin-polyfill-corejs3", BABEL_COREJS_OPTS]);
  }


  const plugins = [];
  if (!disableLicenseHeader) {
    plugins.push(
      new webpack2.BannerPlugin({
        banner: licenseHeaderLibre + "\n" + versionInfoHeader,
        raw: true,
      })
    );
  }
  plugins.push({
    /** @param {import('webpack').Compiler} compiler */
    apply(compiler) {
      const errors = [];

      compiler.hooks.afterCompile.tap("VerifyImportMeta", compilation => {
        for (const asset of compilation.getAssets()) {
          if (asset.name.endsWith(".mjs")) {
            const source = asset.source.source();
            if (
              typeof source === "string" &&
              /new URL\([^,)]*,\s*import\.meta\.url/.test(source)
            ) {
              errors.push(
                `Output module ${asset.name} uses new URL(..., import.meta.url)`
              );
            }
          }
        }
      });
      compiler.hooks.afterEmit.tap("VerifyImportMeta", compilation => {
        // Emit the errors after emitting the files, so that it's possible to
        // look at the contents of the invalid bundle.
        compilation.errors.push(...errors);
      });
    },
  });

  const alias = createWebpackAlias();
  const experiments = isModule ? { outputModule: true } : undefined;

  // Required to expose e.g., the `window` object.
  output.globalObject = "globalThis";

  return {
    mode: "production",
    optimization: { mangleExports: false, minimize: false },
    experiments,
    output,
    performance: {
      hints: false, // Disable messages about larger file sizes.
    },
    plugins,
    resolve: {
      alias,
    },
    devtool: enableSourceMaps ? "source-map" : undefined,
    module: {
      parser: {
        javascript: {
          importMeta: false,
          url: false,
        },
      },
      rules: [
        {
          test: /\.[mc]?js$/,
          loader: "babel-loader",
          exclude: babelExcludeRegExp,
          options: {
            presets: babelPresets,
            plugins: babelPlugins,
            targets: BABEL_TARGETS,
          },
        },
      ],
    },
    // Avoid shadowing actual Node.js variables with polyfills, by disabling
    // polyfills/mocks - https://webpack.js.org/configuration/node/
    node: false,
  };
}

function webpack2Stream(webpackConfig) {
  // Replacing webpack1 to webpack2 in the webpack-stream.
  return webpackStream(webpackConfig, webpack2);
}

function getVersionJSON() {
  return JSON.parse(fs.readFileSync(BUILD_DIR + "version.json").toString());
}

function createMainBundle(defines) {
  const mainFileConfig = createWebpackConfig(defines, {
    filename: defines.MINIFIED ? "pdf.min.mjs" : "pdf.mjs",
    library: {
      type: "module",
    },
  });
  return gulp
    .src("./src/pdf.js", { encoding: false })
    .pipe(webpack2Stream(mainFileConfig));
}

function createScriptingBundle(defines, extraOptions = undefined) {
  const scriptingFileConfig = createWebpackConfig(
    defines,
    {
      filename: "pdf.scripting.mjs",
      library: {
        type: "module",
      },
    },
    extraOptions
  );
  return gulp
    .src("./src/pdf.scripting.js", { encoding: false })
    .pipe(webpack2Stream(scriptingFileConfig));
}

function createTemporaryScriptingBundle(defines, extraOptions = undefined) {
  return createScriptingBundle(defines, {
    disableVersionInfo: !!extraOptions?.disableVersionInfo,
    disableSourceMaps: true,
    disableLicenseHeader: true,
  }).pipe(gulp.dest(TMP_DIR));
}

function createSandboxBundle(defines, extraOptions = undefined) {
  const scriptingPath = TMP_DIR + "pdf.scripting.mjs";
  // Insert the source as a string to be `eval`-ed in the sandbox.
  const sandboxDefines = {
    ...defines,
    PDF_SCRIPTING_JS_SOURCE: fs.readFileSync(scriptingPath).toString(),
  };
  fs.unlinkSync(scriptingPath);

  const sandboxFileConfig = createWebpackConfig(
    sandboxDefines,
    {
      filename: sandboxDefines.MINIFIED
        ? "pdf.sandbox.min.mjs"
        : "pdf.sandbox.mjs",
      library: {
        type: "module",
      },
    },
    extraOptions
  );

  return gulp
    .src("./src/pdf.sandbox.js", { encoding: false })
    .pipe(webpack2Stream(sandboxFileConfig));
}

function createWorkerBundle(defines) {
  const workerDefines = {
    ...defines,
    WORKER_THREAD: true,
  };
  const workerFileConfig = createWebpackConfig(workerDefines, {
    filename: workerDefines.MINIFIED ? "pdf.worker.min.mjs" : "pdf.worker.mjs",
    library: {
      type: "module",
    },
  });
  return gulp
    .src("./src/pdf.worker.js", { encoding: false })
    .pipe(webpack2Stream(workerFileConfig));
}

function createWebBundle(defines, options) {
  const viewerFileConfig = createWebpackConfig(defines, {
    filename: "viewer.mjs",
    library: {
      type: "module",
    },
  });
  return gulp
    .src("./web/viewer.js", { encoding: false })
    .pipe(webpack2Stream(viewerFileConfig));
}

function createCMapBundle() {
  return gulp.src(["external/bcmaps/*.bcmap", "external/bcmaps/LICENSE"], {
    base: "external/bcmaps",
    encoding: false,
  });
}

function createICCBundle() {
  return gulp.src(["external/iccs/*.icc", "external/iccs/LICENSE"], {
    base: "external/iccs",
    encoding: false,
  });
}

function createStandardFontBundle() {
  return gulp.src(
    [
      "external/standard_fonts/*.pfb",
      "external/standard_fonts/*.ttf",
      "external/standard_fonts/LICENSE_*",
    ],
    {
      base: "external/standard_fonts",
      encoding: false,
    }
  );
}

function createWasmBundle({ includeQuickJS = true } = {}) {
  const sources = [
    gulp.src(
      [
        "external/openjpeg/*.wasm",
        "external/openjpeg/openjpeg_nowasm_fallback.js",
        "external/openjpeg/LICENSE_*",
      ],
      {
        base: "external/openjpeg",
        encoding: false,
      }
    ),
    gulp.src(["external/qcms/*.wasm", "external/qcms/LICENSE_*"], {
      base: "external/qcms",
      encoding: false,
    }),
    gulp.src(
      [
        "external/jbig2/*.wasm",
        "external/jbig2/jbig2_nowasm_fallback.js",
        "external/jbig2/LICENSE_*",
      ],
      {
        base: "external/jbig2",
        encoding: false,
      }
    ),
  ];
  if (includeQuickJS) {
    sources.push(
      gulp.src(
        [
          "external/quickjs/quickjs-eval.js",
          "external/quickjs/quickjs-eval.wasm",
        ],
        {
          base: "external/quickjs",
          encoding: false,
        }
      )
    );
  }
  return ordered(sources);
}

function checkFile(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function checkDir(dirPath) {
  try {
    const stat = fs.lstatSync(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}


function getTempFile(prefix, suffix) {
  fs.mkdirSync(BUILD_DIR + "tmp/", { recursive: true });
  const bytes = crypto.randomBytes(6).toString("hex");
  const filePath = BUILD_DIR + "tmp/" + prefix + bytes + suffix;
  fs.writeFileSync(filePath, "");
  return filePath;
}


function createBuildNumber(done) {
  console.log("\n### Getting extension build number");

  exec(
    "git log --format=oneline " + config.baseVersion + "..",
    function (err, stdout, stderr) {
      let buildNumber = 0;
      if (!err) {
        // Build number is the number of commits since base version
        buildNumber = stdout ? stdout.match(/\n/g).length : 0;
      } else {
        console.log(
          "This is not a Git repository; using default build number."
        );
      }

      console.log("Extension build number: " + buildNumber);

      const version = config.versionPrefix + buildNumber;

      exec('git log --format="%h" -n 1', function (err2, stdout2, stderr2) {
        const buildCommit = !err2 ? stdout2.replace("\n", "") : "";

        createStringSource(
          "version.json",
          JSON.stringify(
            {
              version,
              build: buildNumber,
              commit: buildCommit,
            },
            null,
            2
          )
        )
          .pipe(gulp.dest(BUILD_DIR))
          .on("end", done);
      });
    }
  );
}

function getDefaultFtl() {
  const content = fs.readFileSync("l10n/en-US/viewer.ftl").toString(),
    stringBuf = [];

  // Strip out comments and line-breaks.
  const regExp = /^\s*#/;
  for (const line of content.split("\n")) {
    if (!line || regExp.test(line)) {
      continue;
    }
    stringBuf.push(line);
  }
  return stringBuf.join("\n");
}

gulp.task("locale", function () {
  const VIEWER_LOCALE_OUTPUT = "web/locale/";

  console.log("\n### Building localization files");

  fs.rmSync(VIEWER_LOCALE_OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(VIEWER_LOCALE_OUTPUT, { recursive: true });

  const subfolders = fs.readdirSync(L10N_DIR);
  subfolders.sort();
  const viewerOutput = Object.create(null);
  const locales = [];
  for (const locale of subfolders) {
    const dirPath = L10N_DIR + locale;
    if (!checkDir(dirPath)) {
      continue;
    }
    if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale)) {
      console.log("Skipping invalid locale: " + locale);
      continue;
    }

    fs.mkdirSync(VIEWER_LOCALE_OUTPUT + "/" + locale, { recursive: true });

    locales.push(locale);

    if (checkFile(dirPath + "/viewer.ftl")) {
      // The L10n-implementations, in the viewer, use lowercase language-codes
      // internally.
      viewerOutput[locale.toLowerCase()] = `${locale}/viewer.ftl`;
    }
  }
  const glob = locales.length === 1 ? locales[0] : `{${locales.join(",")}}`;

  return ordered([
    createStringSource("locale.json", JSON.stringify(viewerOutput)).pipe(
      gulp.dest(VIEWER_LOCALE_OUTPUT)
    ),
    gulp
      .src(`${L10N_DIR}/${glob}/viewer.ftl`, {
        base: L10N_DIR,
        encoding: false,
      })
      .pipe(gulp.dest(VIEWER_LOCALE_OUTPUT)),
  ]);
});

function preprocessCSS(source, defines) {
  const outName = getTempFile("~preprocess", ".css");
  preprocess(source, outName, defines);
  const out = fs.readFileSync(outName).toString();
  fs.unlinkSync(outName);

  const i = source.lastIndexOf("/");
  return createStringSource(source.substr(i + 1), out);
}

function discardCommentsCSS() {
  let copyrightNum = 0;

  function remove(comment) {
    // Remove all comments, except the *first* license header.
    if (comment.startsWith("Copyright") && copyrightNum++ === 0) {
      return false;
    }
    return true;
  }
  return postcssDiscardComments({ remove });
}

function preprocessHTML(source, defines) {
  defines = {
    ...defines,
    TESTING: defines.TESTING ?? process.env.TESTING === "true",
  };
  const outName = getTempFile("~preprocess", ".html");
  preprocess(source, outName, defines);
  const out = fs.readFileSync(outName).toString();
  fs.unlinkSync(outName);

  const i = source.lastIndexOf("/");
  return createStringSource(source.substr(i + 1), `${out.trimEnd()}\n`);
}

function buildGeneric(defines, dir) {
  fs.rmSync(dir, { recursive: true, force: true });

  return ordered([
    createMainBundle(defines).pipe(gulp.dest(dir + "build")),
    createWorkerBundle(defines).pipe(gulp.dest(dir + "build")),
    createSandboxBundle(defines).pipe(gulp.dest(dir + "build")),
    createWebBundle(defines).pipe(gulp.dest(dir + "web")),
    gulp
      .src(COMMON_WEB_FILES, { base: "web/", encoding: false })
      .pipe(gulp.dest(dir + "web")),
    gulp.src("LICENSE", { encoding: false }).pipe(gulp.dest(dir)),
    gulp
      .src(["web/locale/*/viewer.ftl", "web/locale/locale.json"], {
        base: "web/",
        encoding: false,
      })
      .pipe(gulp.dest(dir + "web")),
    createCMapBundle().pipe(gulp.dest(dir + "web/cmaps")),
    createICCBundle().pipe(gulp.dest(dir + "web/iccs")),
    createStandardFontBundle().pipe(gulp.dest(dir + "web/standard_fonts")),
    createWasmBundle().pipe(gulp.dest(dir + "web/wasm")),

    preprocessHTML("web/viewer.html", defines).pipe(gulp.dest(dir + "web")),
    preprocessCSS("web/viewer.css", defines)
      .pipe(postcss([discardCommentsCSS(), autoprefixer(AUTOPREFIXER_CONFIG)]))
      .pipe(gulp.dest(dir + "web")),

    gulp
      .src("web/compressed.tracemonkey-pldi-09.pdf", { encoding: false })
      .pipe(gulp.dest(dir + "web")),
  ]);
}

// Builds the generic production viewer that is only compatible with up-to-date
// HTML5 browsers, which implement modern ECMAScript features.
gulp.task(
  "generic",
  gulp.series(
    createBuildNumber,
    "locale",
    function scriptingGeneric() {
      const defines = { ...DEFINES, GENERIC: true };
      return createTemporaryScriptingBundle(defines);
    },
    function createGeneric() {
      console.log("\n### Creating generic viewer");
      const defines = { ...DEFINES, GENERIC: true };

      return buildGeneric(defines, GENERIC_DIR);
    }
  )
);

// Builds the generic production viewer that should be compatible with most
// older HTML5 browsers.
gulp.task(
  "generic-legacy",
  gulp.series(
    createBuildNumber,
    "locale",
    function scriptingGenericLegacy() {
      const defines = { ...DEFINES, GENERIC: true, SKIP_BABEL: false };
      return createTemporaryScriptingBundle(defines);
    },
    function createGenericLegacy() {
      console.log("\n### Creating generic (legacy) viewer");
      const defines = { ...DEFINES, GENERIC: true, SKIP_BABEL: false };

      return buildGeneric(defines, GENERIC_LEGACY_DIR);
    }
  )
);

