const repo = 'sirhans/Essentia-Duluth-CRNA-Scheduling-Tools';
const latestReleaseUrl = `https://github.com/${repo}/releases/latest`;
const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;

const macLink = document.getElementById('mac-download');
const windowsLink = document.getElementById('windows-download');
const releaseNote = document.getElementById('release-note');

function assetFor(release, extension) {
  return release.assets.find((asset) =>
    asset.name.toLowerCase().endsWith(extension)
  );
}

fetch(apiUrl, { headers: { Accept: 'application/vnd.github+json' } })
  .then((response) => {
    if (!response.ok) throw new Error('No release available');
    return response.json();
  })
  .then((release) => {
    const macAsset = assetFor(release, '.dmg');
    const windowsAsset = assetFor(release, '.exe');

    if (macAsset) macLink.href = macAsset.browser_download_url;
    if (windowsAsset) windowsLink.href = windowsAsset.browser_download_url;

    releaseNote.textContent = `Latest release: ${release.tag_name}`;
  })
  .catch(() => {
    macLink.href = latestReleaseUrl;
    windowsLink.href = latestReleaseUrl;
    releaseNote.textContent = 'Release downloads will appear after the first published release.';
  });
