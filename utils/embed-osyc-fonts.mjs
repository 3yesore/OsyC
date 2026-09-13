import fs from "node:fs";

const specs = [
    ["Noto Sans SC", "osyc-noto-sans-sc-400.woff2", 400, "U+3400-4DBF,U+4E00-9FFF,U+F900-FAFF"],
    ["Noto Sans SC", "osyc-noto-sans-sc-600.woff2", 600, "U+3400-4DBF,U+4E00-9FFF,U+F900-FAFF"],
    ["Inter", "osyc-inter-400.woff2", 400, "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"],
    ["Inter", "osyc-inter-600.woff2", 600, "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"],
    ["JetBrains Mono", "osyc-jetbrains-mono-400.woff2", 400, "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"],
    ["JetBrains Mono", "osyc-jetbrains-mono-600.woff2", 600, "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"],
];

const marker = "/* OsyC bundled fonts. Font binaries are OFL-1.1; see docs/licenses/fonts. */";
const existing = fs.readFileSync("styles.css", "utf8");
const withoutPrevious = existing.includes(marker) ? existing.slice(0, existing.indexOf(marker)).trimEnd() : existing.trimEnd();
let css = `\n\n${marker}\n`;
for (const [family, file, weight, range] of specs) {
    const data = fs.readFileSync(`assets/fonts/${file}`).toString("base64");
    css += `@font-face { font-family: "${family}"; font-style: normal; font-weight: ${weight}; font-display: swap; src: url("data:font/woff2;base64,${data}") format("woff2"); unicode-range: ${range}; }\n`;
}
fs.writeFileSync("styles.css", `${withoutPrevious}${css}`);
