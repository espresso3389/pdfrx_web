(() => {
  const demoPaths = ['/pdfrx_web/demo/', '/pdfrx_web/demo-react/'];

  for (const link of document.querySelectorAll('a[href]')) {
    let url;
    try {
      url = new URL(link.href, window.location.href);
    } catch {
      continue;
    }

    const isWebUrl = url.protocol === 'http:' || url.protocol === 'https:';
    const isExternalOrigin = url.origin !== window.location.origin;
    const isDemo = demoPaths.some((path) => url.pathname.startsWith(path));
    if (!isWebUrl || (!isExternalOrigin && !isDemo)) continue;

    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
})();
