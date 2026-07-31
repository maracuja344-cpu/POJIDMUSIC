/* =========================================================
   1. ЗАПУСК КАРУСЕЛИ РЕКОМЕНДАЦИЙ
   ========================================================= */

let activeCarouselCleanup = null;


/*
Создаёт бесконечную горизонтальную карусель:

- оригинальные карточки остаются в начале;
- их копии добавляются справа;
- прокрутка идёт автоматически;
- при ручном взаимодействии автоскролл временно ставится на паузу.
*/
export function initializeRecommendationsCarousel() {
    activeCarouselCleanup?.();
    activeCarouselCleanup = null;

    /*
    Видимая область карусели.
    Именно она прокручивается по горизонтали.
    */
    const viewport = document.querySelector(
        ".recommendations-viewport"
    );

    /*
    Длинная внутренняя лента,
    в которой лежат карточки рекомендаций.
    */
    const track = document.querySelector(
        ".recommendations-track"
    );

    /*
    Если обязательных элементов нет,
    карусель не запускается.
    */
    if (!viewport || !track) return;


    /* =====================================================
       2. ОЧИСТКА СТАРЫХ КЛОНОВ
       ===================================================== */

    /*
    Если функция случайно запустится повторно,
    старые копии сначала удаляются.

    Без этого карточки могли бы умножаться
    после повторного рендера или переинициализации.
    */
    track
        .querySelectorAll('[data-clone="true"]')
        .forEach((clone) => {
            clone.remove();
        });


    /* =====================================================
       3. ПОЛУЧЕНИЕ ОРИГИНАЛЬНЫХ КАРТОЧЕК
       ===================================================== */

    /*
    После удаления копий в track остаются
    только настоящие карточки рекомендаций.
    */
    const originalCards = Array.from(
        track.children
    );

    /*
    Если рекомендаций нет,
    запускать карусель бессмысленно.
    */
    if (originalCards.length === 0) return;


    /* =====================================================
       4. СОСТОЯНИЕ КАРУСЕЛИ
       ===================================================== */

    /*
    Таймер отвечает за возобновление прокрутки
    после ручного взаимодействия.
    */
    let resumeTimer = null;

    /*
    При true автоматическая прокрутка остановлена.
    */
    let isPaused = false;
    let isHovering = false;
    let isPointerInteracting = false;

    /*
    Текущая виртуальная позиция прокрутки.

    Она хранится отдельно от scrollLeft,
    потому что скорость может быть дробной.
    */
    let position = viewport.scrollLeft;

    /*
    Идентификатор requestAnimationFrame.

    Он нужен, чтобы при необходимости
    остановить уже запущенный цикл.
    */
    let animationFrameId = null;
    let carouselStartTimer = null;
    let resizeTimer = null;
    let destroyed = false;
    const listenerController = new AbortController();
    const listenerOptions = {
        signal: listenerController.signal
    };

    /*
    Скорость автоматического движения
    в пикселях за один кадр.
    */
    const scrollSpeed = 0.25;

    /*
    Через сколько миллисекунд после ручной прокрутки
    снова запускать автоматическое движение.
    */
    const resumeDelay = 3000;


    /* =====================================================
       5. СОЗДАНИЕ КОПИЙ
       ===================================================== */

    /*
    Добавляет одну полную копию
    всех оригинальных карточек.
    */
    function appendCopies() {
        originalCards.forEach((card) => {
            const clone = card.cloneNode(true);

            /*
            Помечаем копию, чтобы:

            - отличать её от оригинала;
            - не учитывать как отдельный трек;
            - удалять при повторной инициализации.
            */
            clone.dataset.clone = "true";

            /*
            Клон должен быть видимым сразу
            и не проигрывать повторную анимацию появления.
            */
            track.append(clone);
        });
    }


    /*
    Сначала добавляем одну копию,
    чтобы вычислить ширину полного набора карточек.
    */
    appendCopies();


    /* =====================================================
       6. ВЫЧИСЛЕНИЕ ШИРИНЫ ОДНОГО ЦИКЛА
       ===================================================== */

    /*
    Первый клон начинается ровно там,
    где заканчивается набор оригиналов.
    */
    const firstClone =
        track.children[originalCards.length];

    if (!firstClone) return;

    /*
    Расстояние между первой оригинальной карточкой
    и первым клоном равно ширине одного полного цикла.
    */
    const loopWidth =
        firstClone.offsetLeft -
        originalCards[0].offsetLeft;

    /*
    Защита от некорректных размеров.
    */
    if (loopWidth <= 0) return;


    /* =====================================================
       7. ЗАПОЛНЕНИЕ ВИДИМОЙ ОБЛАСТИ
       ===================================================== */

    /*
    Добавляем столько копий, сколько нужно,
    чтобы справа всегда оставался запас карточек.

    Это особенно важно на широком мониторе.
    */
    while (
        track.scrollWidth <
        loopWidth + viewport.clientWidth
    ) {
        appendCopies();
    }


    /* =====================================================
       8. НОРМАЛИЗАЦИЯ ПОЗИЦИИ
       ===================================================== */

    /*
    Возвращает позицию внутрь первого цикла.

    Например:

    850px при loopWidth 600px
    превращается в 250px.
    */
    function normalizePosition(value) {
        if (loopWidth <= 0) return 0;

        let normalizedValue =
            value % loopWidth;

        /*
        На случай отрицательного значения.
        */
        if (normalizedValue < 0) {
            normalizedValue += loopWidth;
        }

        return normalizedValue;
    }

    position = normalizePosition(position);
    viewport.scrollLeft = position;


    /* =====================================================
       9. АВТОМАТИЧЕСКАЯ ПРОКРУТКА
       ===================================================== */

    function autoScroll() {
        if (destroyed) return;

        /*
        Когда вкладка браузера скрыта,
        не двигаем карусель впустую.
        */
        if (
            !isPaused &&
            !document.hidden
        ) {
            position += scrollSpeed;

            /*
            После полного прохода возвращаемся
            в ту же визуальную точку первого цикла.

            Пользователь не замечает скачка,
            потому что справа находятся идентичные копии.
            */
            if (position >= loopWidth) {
                position -= loopWidth;
            }

            viewport.scrollLeft = position;
        }

        animationFrameId =
            requestAnimationFrame(autoScroll);
    }


    /* =====================================================
       10. ПАУЗА ПРИ РУЧНОМ УПРАВЛЕНИИ
       ===================================================== */

    /*
    Останавливает автоскролл
    и запоминает фактическую позицию.
    */
    function pauseScroll() {
        isPaused = true;

        position =
            normalizePosition(
                viewport.scrollLeft
            );

        clearTimeout(resumeTimer);
    }


    /*
    Возобновляет движение спустя несколько секунд.
    */
    function resumeScrollLater() {
        clearTimeout(resumeTimer);

        position =
            normalizePosition(
                viewport.scrollLeft
            );

        /*
        Сразу переносим viewport
        в нормализованную визуально равную точку.

        Это не заметно, потому что карточки повторяются.
        */
        viewport.scrollLeft = position;

        resumeTimer = setTimeout(() => {
            isPaused = isHovering;
        }, resumeDelay);
    }


    /* =====================================================
       11. СОБЫТИЯ МЫШИ И КАСАНИЯ
       ===================================================== */

    /*
    Пользователь начал тянуть карусель.
    */
    viewport.addEventListener(
        "pointerdown",
        () => {
            isPointerInteracting = true;
            pauseScroll();
        },
        listenerOptions
    );


    /*
    Пользователь закончил перетаскивание.
    */
    viewport.addEventListener(
        "pointerup",
        () => {
            isPointerInteracting = false;
            resumeScrollLater();
        },
        listenerOptions
    );


    /*
    Касание или перетаскивание было отменено.
    */
    viewport.addEventListener(
        "pointercancel",
        () => {
            isPointerInteracting = false;
            resumeScrollLater();
        },
        listenerOptions
    );


    /*
    Если указатель ушёл за пределы элемента
    во время зажатия, тоже готовим возобновление.
    */
    viewport.addEventListener(
        "pointerleave",
        (event) => {
            const wasInteracting =
                isPointerInteracting;

            isPointerInteracting = false;
            isHovering = false;

            if (!isPaused) return;

            if (
                wasInteracting ||
                event.pointerType !== "mouse"
            ) {
                resumeScrollLater();
            } else {
                window.clearTimeout(resumeTimer);
                resumeTimer = null;
                isPaused = false;
            }
        },
        listenerOptions
    );


    /*
    Колесо мыши или горизонтальный жест тачпада.
    */
    viewport.addEventListener(
        "wheel",
        () => {
            pauseScroll();
            resumeScrollLater();
        },
        {
            passive: true,
            signal: listenerController.signal
        }
    );

    if (
        window.matchMedia(
            "(hover: hover) and (pointer: fine)"
        ).matches
    ) {
        viewport.addEventListener(
            "mouseenter",
            () => {
                isHovering = true;
                pauseScroll();
            },
            listenerOptions
        );
    }


    /*
    Событие scroll синхронизирует виртуальную позицию
    с ручной прокруткой пользователя.
    */
    viewport.addEventListener(
        "scroll",
        () => {
            if (!isPaused) return;

            position =
                normalizePosition(
                    viewport.scrollLeft
                );
        },
        {
            passive: true,
            signal: listenerController.signal
        }
    );


    /* =====================================================
       12. ПОВЕДЕНИЕ ПРИ СКРЫТИИ ВКЛАДКИ
       ===================================================== */

    /*
    Когда пользователь возвращается на вкладку,
    синхронизируем позицию с реальным scrollLeft.
    */
    document.addEventListener(
        "visibilitychange",
        () => {
            if (!document.hidden) {
                position =
                    normalizePosition(
                        viewport.scrollLeft
                    );
            }
        },
        listenerOptions
    );

    window.addEventListener(
        "resize",
        () => {
            window.clearTimeout(resizeTimer);

            resizeTimer = window.setTimeout(() => {
                if (!destroyed) {
                    initializeRecommendationsCarousel();
                }
            }, 180);
        },
        listenerOptions
    );


    /* =====================================================
       13. ЗАПУСК ЦИКЛА
       ===================================================== */

    function startAutoScrollAfterReveal() {
        if (
            destroyed ||
            animationFrameId !== null ||
            carouselStartTimer !== null
        ) {
            return;
        }

        carouselStartTimer = window.setTimeout(
            () => {
                carouselStartTimer = null;
                autoScroll();
            },
            300
        );
    }

    const recommendationsSection =
        document.querySelector(
            ".recommendations-section"
        );

    if (
        !recommendationsSection ||
        recommendationsSection.classList.contains(
            "is-visible"
        )
    ) {
        startAutoScrollAfterReveal();
    } else {
        recommendationsSection.addEventListener(
            "revealvisible",
            startAutoScrollAfterReveal,
            {
                once: true,
                signal: listenerController.signal
            }
        );
    }

    activeCarouselCleanup = () => {
        destroyed = true;
        listenerController.abort();

        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        window.clearTimeout(resumeTimer);
        window.clearTimeout(carouselStartTimer);
        window.clearTimeout(resizeTimer);

        resumeTimer = null;
        carouselStartTimer = null;
        resizeTimer = null;

        track
            .querySelectorAll('[data-clone="true"]')
            .forEach((clone) => {
                clone.remove();
            });
    };
}
