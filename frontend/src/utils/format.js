const KIBIBYTE = 1024;
const MEBIBYTE = KIBIBYTE ** 2;
const GIBIBYTE = KIBIBYTE ** 3;

function formatUnit(bytes, unitBytes, unit) {
  return `${Number((bytes / unitBytes).toFixed(2))} ${unit}`;
}

export function formatFileSize(bytes) {
  if (bytes < KIBIBYTE) return `${bytes} B`;
  if (bytes < MEBIBYTE) return formatUnit(bytes, KIBIBYTE, 'KB');
  if (bytes < GIBIBYTE) return formatUnit(bytes, MEBIBYTE, 'MB');
  return formatUnit(bytes, GIBIBYTE, 'GB');
}

export function formatStorageSize(bytes) {
  if (bytes === 0) return '0 MB';

  const megabytes = bytes / MEBIBYTE;
  if (megabytes < 0.01) return '<0.01 MB';
  if (bytes < GIBIBYTE) return formatUnit(bytes, MEBIBYTE, 'MB');
  return formatUnit(bytes, GIBIBYTE, 'GB');
}

export function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}
