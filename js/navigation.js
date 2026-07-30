const NAVIGATION_SECTION_IDS = [
    "new",
    "all-tracks",
    "recommendations"
];


function setActiveNavigationItem(
    navigationLinks,
    activeSectionId
) {
    navigationLinks.forEach((link) => {
        const isActive =
            link.hash === `#${activeSectionId}`;

        link.classList.toggle(
            "is-active",
            isActive
        );

        if (isActive) {
            link.setAttribute(
                "aria-current",
                "page"
            );
        } else {
            link.removeAttribute(
                "aria-current"
            );
        }
    });
}


export function initializeSectionNavigation() {
    const navigationLinks = Array.from(
        document.querySelectorAll(".nav a[href^='#']")
    ).filter((link) => {
        return NAVIGATION_SECTION_IDS.includes(
            link.hash.slice(1)
        );
    });

    const sections = NAVIGATION_SECTION_IDS
        .map((sectionId) => {
            return document.getElementById(sectionId);
        })
        .filter(Boolean);

    if (
        navigationLinks.length === 0 ||
        sections.length === 0
    ) {
        return;
    }

    const sectionById = new Map(
        sections.map((section) => {
            return [section.id, section];
        })
    );

    const visibleSectionIds = new Set();

    function updateActiveSection() {
        const headerBottom =
            document
                .querySelector(".header")
                ?.getBoundingClientRect()
                .bottom ?? 0;

        const visibleSections = Array.from(
            visibleSectionIds
        )
            .map((sectionId) => {
                return sectionById.get(sectionId);
            })
            .filter(Boolean)
            .sort((firstSection, secondSection) => {
                const firstDistance = Math.abs(
                    firstSection
                        .getBoundingClientRect()
                        .top -
                    headerBottom
                );

                const secondDistance = Math.abs(
                    secondSection
                        .getBoundingClientRect()
                        .top -
                    headerBottom
                );

                return firstDistance - secondDistance;
            });

        if (visibleSections.length > 0) {
            setActiveNavigationItem(
                navigationLinks,
                visibleSections[0].id
            );
        }
    }

    navigationLinks.forEach((link) => {
        link.addEventListener("click", () => {
            setActiveNavigationItem(
                navigationLinks,
                link.hash.slice(1)
            );
        });
    });

    const initialSectionId =
        NAVIGATION_SECTION_IDS.includes(
            window.location.hash.slice(1)
        )
            ? window.location.hash.slice(1)
            : NAVIGATION_SECTION_IDS[0];

    setActiveNavigationItem(
        navigationLinks,
        initialSectionId
    );

    if (!("IntersectionObserver" in window)) {
        return;
    }

    const headerHeight =
        document
            .querySelector(".header")
            ?.getBoundingClientRect()
            .height ?? 0;

    const sectionObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    visibleSectionIds.add(
                        entry.target.id
                    );
                } else {
                    visibleSectionIds.delete(
                        entry.target.id
                    );
                }
            });

            updateActiveSection();
        },
        {
            rootMargin:
                `-${Math.ceil(headerHeight)}px 0px -55% 0px`,
            threshold: 0
        }
    );

    sections.forEach((section) => {
        sectionObserver.observe(section);
    });
}
