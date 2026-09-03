const cssHref = new URL("../track-upload-wizard.css", import.meta.url).href;

if (!document.querySelector('link[data-track-upload-wizard-style]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssHref;
    link.dataset.trackUploadWizardStyle = "true";
    document.head.append(link);
}

await import("./track-upload-wizard.js");
