let refreshBound = false;

function ensureDiscoveryStyles() {
    if (document.querySelector('link[data-home-discovery-styles]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'home-discovery.css';
    link.dataset.homeDiscoveryStyles = 'true';
    document.head.append(link);
}

function shuffleRecommendationCards(track) {
    const cards = Array.from(track.children);
    for (let i = cards.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    cards.forEach((card) => track.append(card));
}

function ensureRefreshButton(section, track) {
    const heading = section.querySelector('.section-title');
    if (!heading || heading.querySelector('.home-recommendations-refresh')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'home-recommendations-refresh';
    button.setAttribute('aria-label', 'Обновить рекомендации');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"></path><path d="M4 17v-5h5"></path><path d="M6.1 9a7 7 0 0 1 11.4-2.3L20 9"></path><path d="M17.9 15a7 7 0 0 1-11.4 2.3L4 15"></path></svg><span>Обновить</span>';
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        shuffleRecommendationCards(track);
    });
    heading.append(button);
}

/*
 * Home discovery intentionally has only one horizontal carousel:
 * fresh releases. Recommendations are a compact static list, followed by
 * the complete catalog. The exported name is kept for the existing boot API.
 */
export function initializeRecommendationsCarousel() {
    ensureDiscoveryStyles();

    const catalog = document.querySelector('#catalog-view');
    const newSection = document.querySelector('#new');
    const recommendations = document.querySelector('#recommendations');
    const allTracks = document.querySelector('#all-tracks');
    const recommendationTrack = recommendations?.querySelector('.recommendations-track');

    if (!catalog || !newSection || !recommendations || !allTracks || !recommendationTrack) return;

    newSection.classList.add('home-new-carousel');
    recommendations.classList.add('home-recommendations-list');

    // Product order: fresh releases -> discovery -> full catalog.
    newSection.after(recommendations);
    recommendations.after(allTracks);

    // Old infinite-carousel clones must never survive a reinitialization.
    recommendationTrack.querySelectorAll('[data-clone="true"]').forEach((clone) => clone.remove());
    ensureRefreshButton(recommendations, recommendationTrack);
}
