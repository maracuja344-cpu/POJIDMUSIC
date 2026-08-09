const DEFAULT_CROP = Object.freeze({ x: 0.5, y: 0.5, zoom: 1 });
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
let activeRequest = null;
const backgroundObservers = new WeakMap();

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

function getElements() {
    const modal = document.querySelector("[data-crop-modal]");
    return {
        modal,
        canvas: modal?.querySelector("[data-crop-canvas]"),
        title: modal?.querySelector("[data-crop-title]"),
        zoom: modal?.querySelector("[data-crop-zoom]"),
        replace: modal?.querySelector("[data-crop-replace]"),
        replaceInput: modal?.querySelector("[data-crop-replace-input]"),
        save: modal?.querySelector("[data-crop-save]"),
        cancel: modal?.querySelector("[data-crop-cancel]")
    };
}

function normalizeCrop(crop) {
    return {
        x: clamp(Number(crop?.x ?? DEFAULT_CROP.x), 0, 1),
        y: clamp(Number(crop?.y ?? DEFAULT_CROP.y), 0, 1),
        zoom: clamp(Number(crop?.zoom ?? DEFAULT_CROP.zoom), 1, 4)
    };
}

function loadImage(source) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        if (typeof source === "string") image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Не удалось открыть изображение."));
        image.src = source instanceof Blob ? URL.createObjectURL(source) : source;
        if (source instanceof Blob) image.addEventListener("load", () => URL.revokeObjectURL(image.src), { once: true });
    });
}

function drawCrop(context, image, width, height, crop) {
    const coverScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const scale = coverScale * crop.zoom;
    const renderedWidth = image.naturalWidth * scale;
    const renderedHeight = image.naturalHeight * scale;
    const x = clamp(width / 2 - crop.x * renderedWidth, width - renderedWidth, 0);
    const y = clamp(height / 2 - crop.y * renderedHeight, height - renderedHeight, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(image, x, y, renderedWidth, renderedHeight);
    return { renderedWidth, renderedHeight };
}

function canvasBlob(canvas, quality = 0.88) {
    return new Promise((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("Не удалось подготовить изображение.")),
        "image/webp",
        quality
    ));
}

async function createMasterBlob(image, maximumWidth, maximumHeight) {
    const scale = Math.min(1, maximumWidth / image.naturalWidth, maximumHeight / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvasBlob(canvas);
}

async function createCroppedBlob(image, crop, size = 1200) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    drawCrop(context, image, size, size, crop);
    return canvasBlob(canvas);
}

export function applyFocalBackground(element, url, crop = DEFAULT_CROP) {
    backgroundObservers.get(element)?.disconnect();
    element.style.backgroundImage = url ? `url("${String(url).replaceAll('"', "%22")}")` : "";
    if (!url) return;
    const state = normalizeCrop(crop);
    const image = new Image();
    image.onload = () => {
        const render = () => {
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const coverScale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
            const width = image.naturalWidth * coverScale * state.zoom;
            const height = image.naturalHeight * coverScale * state.zoom;
            const x = clamp(rect.width / 2 - state.x * width, rect.width - width, 0);
            const y = clamp(rect.height / 2 - state.y * height, rect.height - height, 0);
            element.style.backgroundSize = `${width}px ${height}px`;
            element.style.backgroundPosition = `${x}px ${y}px`;
            element.style.backgroundRepeat = "no-repeat";
        };
        render();
        const observer = new ResizeObserver(render);
        observer.observe(element);
        backgroundObservers.set(element, observer);
    };
    image.src = url;
}

export async function openImageCropper({
    source,
    mode,
    crop,
    upload = false,
    allowReplace = false,
    maxReplacementBytes = Number.POSITIVE_INFINITY
}) {
    if (activeRequest) throw new Error("Редактор кадрирования уже открыт.");
    const elements = getElements();
    if (!elements.modal || !elements.canvas) throw new Error("Редактор кадрирования недоступен.");
    let image = await loadImage(source);
    const state = normalizeCrop(crop);
    const banner = mode === "banner";
    const canvas = elements.canvas;
    canvas.width = banner ? 1200 : 720;
    const heroRect = banner
        ? document.querySelector(".artist-hero")?.getBoundingClientRect()
        : null;
    const heroAspect = heroRect?.width && heroRect?.height
        ? clamp(heroRect.width / heroRect.height, 0.9, 3.2)
        : 1200 / 420;
    canvas.height = banner ? Math.round(canvas.width / heroAspect) : 720;
    elements.modal.dataset.cropMode = mode;
    elements.title.textContent = mode === "banner" ? "Кадрирование баннера" : mode === "cover" ? "Кадрирование обложки" : "Кадрирование аватара";
    elements.zoom.value = String(state.zoom);
    elements.replace.hidden = !allowReplace;
    elements.replaceInput.value = "";
    let replacementFile = null;
    let shouldUpload = upload;
    let dragging = false;
    let pointerX = 0;
    let pointerY = 0;
    let lastMetrics;
    const render = () => {
        lastMetrics = drawCrop(canvas.getContext("2d", { alpha: false }), image, canvas.width, canvas.height, state);
    };
    render();

    const previousFocus = document.activeElement;
    elements.modal.hidden = false;
    document.body.classList.add("crop-modal-open");
    elements.zoom.focus();

    return new Promise((resolve, reject) => {
        activeRequest = { reject };
        const cleanup = () => {
            elements.modal.hidden = true;
            delete elements.modal.dataset.cropMode;
            document.body.classList.remove("crop-modal-open");
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerUp);
            elements.zoom.removeEventListener("input", onZoom);
            elements.replace.removeEventListener("click", onReplace);
            elements.replaceInput.removeEventListener("change", onReplacementChange);
            elements.save.removeEventListener("click", onSave);
            elements.cancel.removeEventListener("click", onCancel);
            document.removeEventListener("keydown", onKeyDown);
            activeRequest = null;
            previousFocus?.focus?.();
        };
        const onPointerDown = (event) => {
            dragging = true; pointerX = event.clientX; pointerY = event.clientY;
            canvas.setPointerCapture(event.pointerId);
        };
        const onPointerMove = (event) => {
            if (!dragging) return;
            const scaleX = canvas.width / canvas.getBoundingClientRect().width;
            const scaleY = canvas.height / canvas.getBoundingClientRect().height;
            state.x = clamp(state.x - (event.clientX - pointerX) * scaleX / lastMetrics.renderedWidth, 0, 1);
            state.y = clamp(state.y - (event.clientY - pointerY) * scaleY / lastMetrics.renderedHeight, 0, 1);
            pointerX = event.clientX; pointerY = event.clientY; render();
        };
        const onPointerUp = () => { dragging = false; };
        const onZoom = () => { state.zoom = Number(elements.zoom.value); render(); };
        const onReplace = () => elements.replaceInput.click();
        const onReplacementChange = async () => {
            const file = elements.replaceInput.files?.[0];
            elements.replaceInput.value = "";
            if (!file) return;
            if (!IMAGE_TYPES.has(file.type)) {
                window.alert("Выберите изображение JPG, PNG или WebP.");
                return;
            }
            if (file.size > maxReplacementBytes) {
                window.alert(`Изображение должно быть не больше ${Math.round(maxReplacementBytes / 1048576)} МиБ.`);
                return;
            }
            try {
                elements.replace.disabled = true;
                image = await loadImage(file);
                replacementFile = file;
                shouldUpload = true;
                state.x = DEFAULT_CROP.x;
                state.y = DEFAULT_CROP.y;
                state.zoom = DEFAULT_CROP.zoom;
                elements.zoom.value = String(state.zoom);
                render();
            } catch (error) {
                cleanup();
                reject(error);
            } finally {
                elements.replace.disabled = false;
            }
        };
        const onCancel = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
        const onSave = async () => {
            try {
                elements.save.disabled = true;
                let blob = null;
                if (shouldUpload) blob = mode === "cover"
                    ? await createCroppedBlob(image, state)
                    : await createMasterBlob(image, mode === "banner" ? 2400 : 1600, mode === "banner" ? 1600 : 1600);
                cleanup();
                resolve({
                    crop: Object.freeze({ ...state }),
                    blob,
                    replacementFile
                });
            } catch (error) { cleanup(); reject(error); }
            finally { elements.save.disabled = false; }
        };
        const onKeyDown = (event) => {
            if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
            if (event.key !== "Tab") return;
            const focusable = [
                ...(allowReplace ? [elements.replace] : []),
                elements.zoom,
                elements.cancel,
                elements.save
            ];
            const index = focusable.indexOf(document.activeElement);
            const next = event.shiftKey ? (index - 1 + focusable.length) % focusable.length : (index + 1) % focusable.length;
            event.preventDefault(); focusable[next].focus();
        };
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        elements.zoom.addEventListener("input", onZoom);
        elements.replace.addEventListener("click", onReplace);
        elements.replaceInput.addEventListener("change", onReplacementChange);
        elements.save.addEventListener("click", onSave);
        elements.cancel.addEventListener("click", onCancel);
        document.addEventListener("keydown", onKeyDown);
    });
}
