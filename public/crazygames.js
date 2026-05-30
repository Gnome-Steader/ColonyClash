window.isIframedByCrazyGames = (() => {
    try {
        const isCrazyGamesParam = window.location.search.includes('crazygames');
        const isCrazyGamesReferrer = window.self !== window.top && document.referrer && document.referrer.includes('crazygames.com');
        let isCrazyGamesAncestor = false;
        if (window.self !== window.top && window.location.ancestorOrigins) {
            for (let i = 0; i < window.location.ancestorOrigins.length; i++) {
                if (window.location.ancestorOrigins[i].includes('crazygames.com')) {
                    isCrazyGamesAncestor = true;
                    break;
                }
            }
        }
        return isCrazyGamesParam || isCrazyGamesReferrer || isCrazyGamesAncestor;
    } catch (e) {
        return window.location.search.includes('crazygames');
    }
})();

window.cgForceCrazyGames = false;
window.cgQueue = [];
window.cgSdkReady = false;
window.cgScriptLoaded = false;

function loadCrazyGamesSdk() {
    if (window.cgScriptLoaded) return;
    window.cgScriptLoaded = true;

    const script = document.createElement('script');
    script.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
    script.addEventListener('load', () => {
        window.cgSdkReady = true;
        if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.init) {
            const initPromise = window.CrazyGames.SDK.init();
            if (initPromise && initPromise.then) {
                initPromise.then(() => {
                    flushCgQueue();
                });
            } else {
                flushCgQueue();
            }
        } else {
            flushCgQueue();
        }
    });
    document.head.appendChild(script);
}

window.triggerCrazySDK = function() {
    if (window.isIframedByCrazyGames || window.cgForceCrazyGames) return;
    window.cgForceCrazyGames = true;
    loadCrazyGamesSdk();
};

window.cgCall = function(module, method, ...args) {
    if (!window.isIframedByCrazyGames && !window.cgForceCrazyGames) return;
    if (!window.cgScriptLoaded) loadCrazyGamesSdk();
    if (window.cgSdkReady && window.CrazyGames && window.CrazyGames.SDK) {
        if (window.CrazyGames.SDK[module] && typeof window.CrazyGames.SDK[module][method] === 'function') {
            window.CrazyGames.SDK[module][method](...args);
        } else if (typeof window.CrazyGames.SDK[module] === 'function' && method === '') {
            // for SDK.init() etc
            window.CrazyGames.SDK[module](...args);
        }
    } else {
        window.cgQueue.push({ module, method, args });
    }
};

if (window.isIframedByCrazyGames) {
    loadCrazyGamesSdk();
}

function flushCgQueue() {
    while (window.cgQueue.length > 0) {
        const task = window.cgQueue.shift();
        window.cgCall(task.module, task.method, ...task.args);
    }
}
