const STEP_COPY = [
    { eyebrow: "ШАГ 1", title: "Как назовём релиз?", hint: "Название и короткое описание. Всё остальное можно собрать дальше." },
    { eyebrow: "ШАГ 2", title: "Покажи обложку", hint: "Одна общая обложка для всего альбома." },
    { eyebrow: "ШАГ 3", title: "Собери треклист", hint: "Минимум два трека. Названия и аудио можно менять до публикации." },
    { eyebrow: "ШАГ 4", title: "Последняя проверка", hint: "Проверь релиз целиком перед отправкой на модерацию." }
];

function fileName(input) {
    return input?.files?.[0]?.name || "не выбрано";
}

function validateStep(form, step) {
    if (step === 0) {
        const title = String(form.elements.title?.value || "").trim();
        if (!title) return { ok: false, message: "Сначала дай альбому название.", focus: form.elements.title };
    }
    if (step === 1) {
        if (!form.elements.cover?.files?.[0]) return { ok: false, message: "Добавь обложку альбома.", focus: form.elements.cover };
    }
    if (step === 2) {
        const rows = [...form.querySelectorAll(".album-upload-track-row")];
        if (rows.length < 2) return { ok: false, message: "В альбоме должно быть минимум два трека." };
        for (let index = 0; index < rows.length; index += 1) {
            const title = rows[index].querySelector("[data-album-track-title]");
            const audio = rows[index].querySelector("[data-album-track-audio]");
            if (!String(title?.value || "").trim()) return { ok: false, message: `Назови трек №${index + 1}.`, focus: title };
            if (!audio?.files?.[0]) return { ok: false, message: `Добавь аудио для трека №${index + 1}.`, focus: audio };
        }
    }
    return { ok: true };
}

function buildReview(form, review) {
    const title = String(form.elements.title?.value || "").trim() || "Без названия";
    const description = String(form.elements.description?.value || "").trim();
    const rows = [...form.querySelectorAll(".album-upload-track-row")];
    const preview = form.querySelector("[data-album-cover-preview] img");

    review.innerHTML = `
        <div class="album-wizard-review-hero">
            <div class="album-wizard-review-cover" data-review-cover></div>
            <div class="album-wizard-review-copy">
                <span>АЛЬБОМ</span>
                <strong></strong>
                <p></p>
            </div>
        </div>
        <div class="album-wizard-review-list"></div>
    `;
    review.querySelector("strong").textContent = title;
    review.querySelector("p").textContent = description || `${rows.length} трека · готово к отправке`;
    const reviewCover = review.querySelector("[data-review-cover]");
    if (preview?.src) {
        const image = document.createElement("img");
        image.src = preview.src;
        image.alt = "";
        reviewCover.append(image);
    } else {
        reviewCover.textContent = "♪";
    }
    const list = review.querySelector(".album-wizard-review-list");
    rows.forEach((row, index) => {
        const item = document.createElement("div");
        item.className = "album-wizard-review-track";
        const trackTitle = String(row.querySelector("[data-album-track-title]")?.value || "").trim();
        const audio = row.querySelector("[data-album-track-audio]");
        item.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><div><strong></strong><small></small></div><b>✓</b>`;
        item.querySelector("strong").textContent = trackTitle || `Трек ${index + 1}`;
        item.querySelector("small").textContent = fileName(audio);
        list.append(item);
    });
}

export function enhanceAlbumUploadWizard(modal) {
    if (!modal) return;
    const form = modal.querySelector("[data-album-upload-form]");
    if (!form) return;

    if (modal.dataset.albumWizardReady === "true") {
        modal.__albumWizardSetStep?.(0);
        return;
    }
    modal.dataset.albumWizardReady = "true";

    const heading = modal.querySelector(".album-upload-heading");
    const titleField = form.querySelector(".album-upload-field:has(input[name='title'])");
    const descriptionField = form.querySelector(".album-upload-field:has(textarea[name='description'])");
    const coverField = form.querySelector(".album-upload-cover-field");
    const trackHeading = form.querySelector(".album-upload-track-heading");
    const trackList = form.querySelector(".album-upload-track-list");
    const status = form.querySelector("[data-album-upload-status]");
    const oldActions = form.querySelector(".album-upload-actions");
    if (!heading || !titleField || !coverField || !trackHeading || !trackList || !oldActions) return;

    const progress = document.createElement("div");
    progress.className = "album-wizard-progress";
    progress.innerHTML = `<div><span data-album-step-count>1 / 4</span><span data-album-step-name>Основа</span></div><div class="album-wizard-progress-track"><span data-album-progress-fill></span></div>`;
    heading.after(progress);

    const intro = document.createElement("div");
    intro.className = "album-wizard-intro";
    intro.innerHTML = `<span data-album-step-eyebrow>ШАГ 1</span><h3 data-album-step-title></h3><p data-album-step-hint></p>`;
    progress.after(intro);

    const steps = [0, 1, 2, 3].map((index) => {
        const section = document.createElement("section");
        section.className = "album-wizard-step";
        section.dataset.albumWizardStep = String(index);
        intro.after(section);
        return section;
    });
    steps[0].append(titleField);
    if (descriptionField) steps[0].append(descriptionField);
    steps[1].append(coverField);
    steps[2].append(trackHeading, trackList);
    const review = document.createElement("div");
    review.className = "album-wizard-review";
    steps[3].append(review);

    const actions = document.createElement("div");
    actions.className = "album-upload-actions album-wizard-actions";
    actions.innerHTML = `
        <button type="button" data-album-wizard-back>Назад</button>
        <button type="button" class="album-wizard-next" data-album-wizard-next>Дальше</button>
        <button type="submit" class="album-upload-submit" data-album-wizard-submit>Загрузить альбом</button>
    `;
    oldActions.replaceWith(actions);
    if (status) actions.before(status);

    const labels = ["Основа", "Обложка", "Треклист", "Проверка"];
    let currentStep = 0;

    function setInlineError(message = "") {
        if (!status) return;
        status.textContent = message;
        status.dataset.type = message ? "error" : "";
    }

    function setStep(nextStep) {
        currentStep = Math.max(0, Math.min(3, nextStep));
        const copy = STEP_COPY[currentStep];
        modal.dataset.albumWizardStep = String(currentStep);
        steps.forEach((section, index) => { section.hidden = index !== currentStep; });
        intro.querySelector("[data-album-step-eyebrow]").textContent = copy.eyebrow;
        intro.querySelector("[data-album-step-title]").textContent = copy.title;
        intro.querySelector("[data-album-step-hint]").textContent = copy.hint;
        progress.querySelector("[data-album-step-count]").textContent = `${currentStep + 1} / 4`;
        progress.querySelector("[data-album-step-name]").textContent = labels[currentStep];
        progress.querySelector("[data-album-progress-fill]").style.width = `${(currentStep + 1) * 25}%`;
        actions.querySelector("[data-album-wizard-back]").hidden = currentStep === 0;
        actions.querySelector("[data-album-wizard-next]").hidden = currentStep === 3;
        actions.querySelector("[data-album-wizard-submit]").hidden = currentStep !== 3;
        setInlineError("");
        if (currentStep === 3) buildReview(form, review);
        const dialog = modal.querySelector(".album-upload-dialog");
        dialog?.scrollTo({ top: 0, behavior: "smooth" });
        requestAnimationFrame(() => steps[currentStep].querySelector("input:not([type='file']), textarea, button")?.focus({ preventScroll: true }));
    }

    actions.querySelector("[data-album-wizard-back]").addEventListener("click", () => setStep(currentStep - 1));
    actions.querySelector("[data-album-wizard-next]").addEventListener("click", () => {
        const result = validateStep(form, currentStep);
        if (!result.ok) {
            setInlineError(result.message);
            result.focus?.focus?.();
            return;
        }
        setStep(currentStep + 1);
    });

    form.addEventListener("submit", (event) => {
        if (currentStep !== 3) {
            event.preventDefault();
            const result = validateStep(form, currentStep);
            if (!result.ok) {
                setInlineError(result.message);
                result.focus?.focus?.();
                return;
            }
            setStep(currentStep + 1);
        }
    }, true);

    modal.__albumWizardSetStep = setStep;
    setStep(0);
}
