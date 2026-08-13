(function () {
    if (!('serviceWorker' in navigator)) return;

    let refreshing = false;
    let waitingWorker = null;
    const banner = document.getElementById('pwa-update');
    const updateButton = document.getElementById('pwa-update-button');

    function offerUpdate(worker) {
        waitingWorker = worker;
        banner.hidden = false;
    }

    updateButton.addEventListener('click', function () {
        updateButton.disabled = true;
        if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    });

    navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
    });

    window.addEventListener('load', async function () {
        const registration = await navigator.serviceWorker.register('service-worker.js');
        if (registration.waiting && navigator.serviceWorker.controller)
            offerUpdate(registration.waiting);

        registration.addEventListener('updatefound', function () {
            const worker = registration.installing;
            worker.addEventListener('statechange', function () {
                if (worker.state === 'installed' && navigator.serviceWorker.controller)
                    offerUpdate(worker);
            });
        });

        // Long-running installed apps discover main-branch deployments without a restart.
        setInterval(() => registration.update(), 60 * 60 * 1000);
    });
})();
