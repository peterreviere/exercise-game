const filesetPromises = new Map();

export function getAssetBaseUrl() {
  return import.meta.env?.BASE_URL || '/';
}

export function joinAssetPath(baseUrl, relativePath) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${relativePath.replace(/^\//, '')}`;
}

export async function getVisionFileset(baseUrl = getAssetBaseUrl()) {
  const wasmPath = joinAssetPath(baseUrl, 'mediapipe/wasm');
  if (!filesetPromises.has(wasmPath)) {
    filesetPromises.set(wasmPath, import('@mediapipe/tasks-vision').then(({ FilesetResolver }) => (
      FilesetResolver.forVisionTasks(wasmPath)
    )));
  }
  return filesetPromises.get(wasmPath);
}

