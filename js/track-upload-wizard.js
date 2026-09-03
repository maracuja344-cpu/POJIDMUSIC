const STEP_COUNT = 5;

const STEP_COPY = [
    {
        kicker: "Шаг 1",
        title: "Как назовём этот шедевр?",
        subtitle: "Дай треку имя. Всё остальное можно настроить дальше."
    },
    {
        kicker: "Шаг 2",
        title: "Кто здесь звучит?",
        subtitle: "Твой артист подставится автоматически. Добавь соавторов или фит, если они есть."
    },
    {
        kicker: "Шаг 3",
        title: "Закинь аудио",
        subtitle: "MP3, WAV или FLAC. До 50 МиБ."
    },
    {
        kicker: "Шаг 4",
        title: "Теперь лицо трека",
        subtitle: "Выбери обложку. После выбора её можно аккуратно кадрировать."
    },
    {
        kicker: "Шаг 5",
        title: "Последние штрихи",
        subtitle: "Проверь тип релиза, описание и всё, что уйдёт на модерацию."
    }
];

function getWizardElements() {
    const modal = document.querySelector(".track-upload-modal");
    const dialog = modal?.querySelector(".track-upload-dialog");
    const form = modal?.querySelector(".track-upload-form");
    if (!modal || !dialog || !form) return null;

    return {
        modal,
        dialog,
        form,
        titleInput: form.querySelector("#track-upload-title"),
        primaryCredits: form.querySelector('[data-artist-picker="primary"]'),
        featuredCredits: form.querySelector('[data-artist-picker="featured"]'),
        description: form.querySelector("#track-upload-description"),
        releaseType: form.querySelector("#track-upload-release-type"),
        audioInput: form.querySelector("#track-upload-audio"),
        coverInput: form.querySelector("#track-upload-cover"),
        audioField: form.querySelector("#track-upload-audio")?.closest(".track-upload-file-field"),
        coverField: form.querySelector("#track-upload-cover")?.closest(".track-upload-file-field"),
        coverPreview: form.querySelector(".track-upload-cover-preview"),
        submit: form.querySelector(".track-upload-submit-button"),
        close: dialog.querySelector(".track-upload-close-button"),
        message: dialog.querySelector(".track-upload-message")
    };
}

function makeStep(index) {
    const step = document.createElement("section");
    step.className = "track-upload-step";
    step.dataset.uploadStep = String(index);
    step.hidden = index !== 0;

    const copy = STEP_COPY[index];
    const heading = document.createElement("div");
    heading.className = "track-upload-step-copy";
    heading.innerHTML = `
        <p class="track-upload-step-kicker">${copy.kicker}</p>
        <h3 class="track-upload-step-title">${copy.title}</h3>
        <p class="track-upload-step-subtitle">${copy.subtitle}</p>
    `;
    step.append(heading);
    return step;
}

function wrapField(labelText, control) {
    const field = document.createElement("div");
    field.className = "track-upload-step-field";
    const label = document.createElement("label");
    label.textContent = labelText;
    label.htmlFor = control.id;
    field.append(label, control);
    return field;
}

function getChipNames(group) {
    return Array.from(group?.querySelectorAll(".track-upload-credit-chip span") || [])
        .map((node) => node.textContent?.trim())
        .filter(Boolean);
}

function getReleaseLabel(select) {
    return select?.selectedOptions?.[0]?.textContent?.trim() || "Сингл";
}

function validateStep(elements, step) {
    if (step === 0) {
        const value = elements.titleInput?.value.trim() || "";
        if (!value) return "Сначала придумай название трека.";
        if (value.length > 200) return "Название получилось слишком длинным.";
    }

    if (step === 1) {
        const primaryNames = getChipNames(elements.primaryCredits);
        const unfinishedPrimary = elements.primaryCredits
            ?.querySelector("[data-artist-picker-input]")?.value.trim();
        const unfinishedFeatured = elements.featuredCredits
            ?.querySelector("[data-artist-picker-input]")?.value.trim();
        if (!primaryNames.length) return "Нужен хотя бы один основной артист.";
        if (unfinishedPrimary || unfinishedFeatured) {
            return "Выбери артиста из подсказок, прежде чем идти дальше.";
        }
    }

    if (step === 2 && !elements.audioInput?.files?.[0]) {
        return "Сначала выбери аудиофайл.";
    }

    if (step === 3 && !elements.coverInput?.files?.[0]) {
        return "Сначала добавь обложку.";
    }

    return "";
}

function buildWizard(elements) {
    if (elements.dialog.dataset.uploadWizardReady === "true") return null;
    elements.dialog.dataset.uploadWizardReady = "true";
    elements.dialog.classList.add("is-wizard");

    const originalTitleLabel = elements.titleInput?.previousElementSibling;
    if (originalTitleLabel?.tagName === "LABEL") originalTitleLabel.remove();

    const descriptionLabel = elements.description?.previousElementSibling;
    if (descriptionLabel?.tagName === "LABEL") descriptionLabel.remove();

    const releaseLabel = elements.releaseType?.previousElementSibling;
    if (releaseLabel?.tagName === "LABEL") releaseLabel.remove();

    const progress = document.createElement("div");
    progress.className = "track-upload-wizard-progress";
    progress.innerHTML = `
        <div class="track-upload-wizard-progress-row">
            <span data-upload-step-label>1 / ${STEP_COUNT}</span>
            <span data-upload-step-name>Название</span>
        </div>
        <div class="track-upload-wizard-progress-track" aria-hidden="true">
            <div class="track-upload-wizard-progress-fill"></div>
        </div>
    `;
    elements.message.before(progress);

    const steps = Array.from({ length: STEP_COUNT }, (_, index) => makeStep(index));

    if (elements.titleInput) {
        elements.titleInput.placeholder = "Например, Ночной автобус";
        steps[0].append(wrapField("Название трека", elements.titleInput));
    }

    if (elements.primaryCredits) steps[1].append(elements.primaryCredits);
    if (elements.featuredCredits) steps[1].append(elements.featuredCredits);

    if (elements.audioField) {
        const zone = document.createElement("div");
        zone.className = "track-upload-wizard-file-zone";
        zone.append(elements.audioField);
        steps[2].append(zone);
    }

    if (elements.coverField) {
        const zone = document.createElement("div");
        zone.className = "track-upload-wizard-file-zone";
        zone.append(elements.coverField);
        steps[3].append(zone);
    }

    const detailsGrid = document.createElement("div");
    detailsGrid.className = "track-upload-wizard-details-grid";
    if (elements.releaseType) {
        detailsGrid.append(wrapField("Тип релиза", elements.releaseType));
    }
    if (elements.description) {
        const field = wrapField("Описание · необязательно", elements.description);
        detailsGrid.append(field);
    }
    steps[4].append(detailsGrid);

    const summary = document.createElement("div");
    summary.className = "track-upload-wizard-summary";
    summary.innerHTML = `
        <div class="track-upload-wizard-summary-cover" data-upload-summary-cover>♪</div>
        <div class="track-upload-wizard-summary-copy">
            <div class="track-upload-wizard-summary-title" data-upload-summary-title>Без названия</div>
            <div class="track-upload-wizard-summary-artists" data-upload-summary-artists>Артист</div>
            <div class="track-upload-wizard-summary-meta" data-upload-summary-meta></div>
        </div>
    `;
    steps[4].append(summary);

    elements.form.prepend(...steps);

    const error = document.createElement("p");
    error.className = "track-upload-wizard-error";
    error.setAttribute("role", "status");
    error.setAttribute("aria-live", "polite");

    const footer = document.createElement("div");
    footer.className = "track-upload-wizard-footer";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "track-upload-wizard-back";
    back.textContent = "Назад";
    back.hidden = true;

    const next = document.createElement("button");
    next.type = "button";
    next.className = "track-upload-wizard-next";
    next.textContent = "Дальше";

    footer.append(back, next);
    elements.form.append(error, footer);

    elements.submit.textContent = "Загрузить трек";
    elements.submit.hidden = true;
    footer.append(elements.submit);

    const success = document.createElement("section");
    success.className = "track-upload-wizard-success";
    success.hidden = true;
    success.innerHTML = `
        <div class="track-upload-wizard-success-mark" aria-hidden="true">✓</div>
        <h3>Улетело на проверку</h3>
        <p>Трек загружен. После модерации он появится в каталоге.</p>
        <div class="track-upload-wizard-success-actions">
            <button type="button" class="track-upload-wizard-success-primary" data-upload-wizard-close>Готово</button>
            <button type="button" class="track-upload-wizard-success-secondary" data-upload-wizard-again>Загрузить ещё</button>
        </div>
    `;
    elements.form.after(success);

    return {
        steps,
        progress,
        progressLabel: progress.querySelector("[data-upload-step-label]"),
        progressName: progress.querySelector("[data-upload-step-name]"),
        error,
        footer,
        back,
        next,
        success,
        summaryTitle: summary.querySelector("[data-upload-summary-title]"),
        summaryArtists: summary.querySelector("[data-upload-summary-artists]"),
        summaryMeta: summary.querySelector("[data-upload-summary-meta]"),
        summaryCover: summary.querySelector("[data-upload-summary-cover]")
    };
}

function initializeWizard() {
    const elements = getWizardElements();
    if (!elements) return;
    const ui = buildWizard(elements);
    if (!ui) return;

    let currentStep = 0;

    const names = ["Название", "Артисты", "Аудио", "Обложка", "Проверка"];

    const updateSummary = () => {
        const title = elements.titleInput?.value.trim() || "Без названия";
        const primary = getChipNames(elements.primaryCredits);
        const featured = getChipNames(elements.featuredCredits);
        const artists = [
            primary.join(" & ") || "Артист",
            featured.length ? `feat. ${featured.join(", ")}` : ""
        ].filter(Boolean).join(" ");
        const audioName = elements.audioInput?.files?.[0]?.name || "аудио не выбрано";

        ui.summaryTitle.textContent = title;
        ui.summaryArtists.textContent = artists;
        ui.summaryMeta.textContent = `${getReleaseLabel(elements.releaseType)} · ${audioName}`;

        const source = elements.coverPreview?.querySelector("img")?.src;
        ui.summaryCover.replaceChildren();
        if (source) {
            const image = document.createElement("img");
            image.src = source;
            image.alt = "";
            ui.summaryCover.append(image);
        } else {
            ui.summaryCover.textContent = "♪";
        }
    };

    const showStep = (nextStep, { focus = true } = {}) => {
        currentStep = Math.max(0, Math.min(STEP_COUNT - 1, nextStep));
        ui.steps.forEach((step, index) => {
            step.hidden = index !== currentStep;
        });
        ui.progressLabel.textContent = `${currentStep + 1} / ${STEP_COUNT}`;
        ui.progressName.textContent = names[currentStep];
        ui.progress.style.setProperty(
            "--track-upload-progress",
            `${((currentStep + 1) / STEP_COUNT) * 100}%`
        );
        ui.back.hidden = currentStep === 0;
        ui.next.hidden = currentStep === STEP_COUNT - 1;
        elements.submit.hidden = currentStep !== STEP_COUNT - 1;
        ui.error.textContent = "";
        updateSummary();

        if (focus) {
            requestAnimationFrame(() => {
                ui.steps[currentStep]
                    ?.querySelector("input:not([type='file']), select, textarea, button, input[type='file']")
                    ?.focus({ preventScroll: true });
            });
        }
    };

    const resetSuccess = () => {
        ui.success.hidden = true;
        elements.form.hidden = false;
        ui.progress.hidden = false;
        if (elements.message?.classList.contains("is-success")) {
            elements.message.hidden = true;
            elements.message.textContent = "";
            elements.message.classList.remove("is-success");
        }
        elements.form.dataset.state = "idle";
        showStep(0, { focus: false });
    };

    ui.next.addEventListener("click", () => {
        const validationError = validateStep(elements, currentStep);
        if (validationError) {
            ui.error.textContent = validationError;
            return;
        }
        showStep(currentStep + 1);
    });

    ui.back.addEventListener("click", () => {
        showStep(currentStep - 1);
    });

    elements.titleInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && currentStep === 0) {
            event.preventDefault();
            ui.next.click();
        }
    });

    [
        elements.titleInput,
        elements.audioInput,
        elements.coverInput,
        elements.releaseType,
        elements.description
    ].filter(Boolean).forEach((control) => {
        control.addEventListener("input", updateSummary);
        control.addEventListener("change", updateSummary);
    });

    const creditObserver = new MutationObserver(updateSummary);
    [elements.primaryCredits, elements.featuredCredits].filter(Boolean).forEach((group) => {
        creditObserver.observe(group, { childList: true, subtree: true });
    });

    const formStateObserver = new MutationObserver(() => {
        if (elements.form.dataset.state !== "success") return;
        updateSummary();
        elements.form.hidden = true;
        ui.progress.hidden = true;
        if (elements.message) elements.message.hidden = true;
        ui.success.hidden = false;
        ui.success.querySelector("[data-upload-wizard-close]")?.focus();
    });
    formStateObserver.observe(elements.form, {
        attributes: true,
        attributeFilter: ["data-state"]
    });

    const modalObserver = new MutationObserver(() => {
        if (elements.modal.hidden) return;
        if (elements.form.dataset.state === "success") resetSuccess();
        showStep(0, { focus: false });
    });
    modalObserver.observe(elements.modal, {
        attributes: true,
        attributeFilter: ["hidden"]
    });

    ui.success.querySelector("[data-upload-wizard-close]")?.addEventListener("click", () => {
        elements.close?.click();
    });

    ui.success.querySelector("[data-upload-wizard-again]")?.addEventListener("click", () => {
        resetSuccess();
        elements.titleInput?.focus();
    });

    elements.form.addEventListener("reset", () => {
        window.setTimeout(() => {
            updateSummary();
        }, 0);
    });

    showStep(0, { focus: false });
}

initializeWizard();
