export const MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024;

export const FILE_POLICIES = Object.freeze([
  { mimeType: 'image/jpeg', extensions: ['.jpg', '.jpeg'], label: 'JPEG image', badge: 'JPG', style: 'img' },
  { mimeType: 'image/png', extensions: ['.png'], label: 'PNG image', badge: 'PNG', style: 'img' },
  { mimeType: 'image/gif', extensions: ['.gif'], label: 'GIF image', badge: 'GIF', style: 'img' },
  { mimeType: 'image/webp', extensions: ['.webp'], label: 'WebP image', badge: 'WEBP', style: 'img' },
  { mimeType: 'video/mp4', extensions: ['.mp4'], label: 'MP4 video', badge: 'MP4', style: 'video' },
  { mimeType: 'video/webm', extensions: ['.webm'], label: 'WebM video', badge: 'WEBM', style: 'video' },
  { mimeType: 'video/quicktime', extensions: ['.mov'], label: 'QuickTime video', badge: 'MOV', style: 'video' },
  { mimeType: 'application/pdf', extensions: ['.pdf'], label: 'PDF document', badge: 'PDF', style: 'pdf' },
  { mimeType: 'text/plain', extensions: ['.txt'], label: 'Text document', badge: 'TXT', style: 'txt' },
  { mimeType: 'application/zip', extensions: ['.zip'], label: 'ZIP archive', badge: 'ZIP', style: 'zip' },
]);

const POLICY_BY_MIME = new Map(FILE_POLICIES.map((policy) => [policy.mimeType, policy]));

export const FILE_INPUT_ACCEPT = FILE_POLICIES.flatMap((policy) => policy.extensions).join(',');
export const SUPPORTED_FORMAT_GUIDANCE = 'JPG, PNG, GIF, WebP, MP4, WebM, MOV, PDF, TXT or ZIP · up to 250 MiB';

function extensionOf(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

export function policyForFile(file) {
  const policy = POLICY_BY_MIME.get(file?.type);
  return policy?.extensions.includes(extensionOf(file?.name || '')) ? policy : null;
}

export function filePresentation(mimeType) {
  const policy = POLICY_BY_MIME.get(mimeType);
  if (policy) return { badge: policy.badge, style: policy.style };
  if (mimeType?.startsWith('image/')) return { badge: 'IMG', style: 'img' };
  if (mimeType?.startsWith('video/')) return { badge: 'VID', style: 'video' };
  return { badge: 'FILE', style: 'generic' };
}
