const coarsePointerQuery = window.matchMedia(
    "(pointer: coarse)"
);
const phoneWidthQuery = window.matchMedia(
    "(max-width: 768px)"
);


function isIOSDevice() {
    return (
        /iPhone|iPad|iPod/i.test(
            navigator.userAgent
        ) ||
        (
            navigator.platform === "MacIntel" &&
            navigator.maxTouchPoints > 1
        )
    );
}


function isSafariBrowser() {
    const userAgent = navigator.userAgent;

    return (
        /Safari/i.test(userAgent) &&
        !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(
            userAgent
        )
    );
}


export function isMobileDevice() {
    return (
        coarsePointerQuery.matches &&
        phoneWidthQuery.matches
    );
}


function updateDeviceClasses() {
    const root = document.documentElement;
    const mobileDevice = isMobileDevice();
    const iosDevice =
        mobileDevice && isIOSDevice();

    root.classList.toggle(
        "mobile-device",
        mobileDevice
    );
    root.classList.toggle(
        "ios-device",
        iosDevice
    );
    root.classList.toggle(
        "ios-safari",
        iosDevice && isSafariBrowser()
    );
}


function listenForQueryChange(
    mediaQuery,
    listener
) {
    if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener(
            "change",
            listener
        );
        return;
    }

    /*
    Старые версии Safari используют устаревший addListener.
    */
    mediaQuery.addListener(listener);
}


function preventIOSGestureZoom() {
    if (!isIOSDevice()) return;

    [
        "gesturestart",
        "gesturechange",
        "gestureend"
    ].forEach((eventName) => {
        document.addEventListener(
            eventName,
            (event) => {
                if (isMobileDevice()) {
                    event.preventDefault();
                }
            },
            {
                passive: false
            }
        );
    });
}


export function initializeMobileEnvironment() {
    updateDeviceClasses();

    listenForQueryChange(
        coarsePointerQuery,
        updateDeviceClasses
    );
    listenForQueryChange(
        phoneWidthQuery,
        updateDeviceClasses
    );

    preventIOSGestureZoom();
}
