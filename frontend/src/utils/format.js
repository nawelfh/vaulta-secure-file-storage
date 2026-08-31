export function formatBytes(bytes) {
  const mebibyte = 1024 ** 2;
  const gibibyte = 1024 ** 3;

  if (bytes === 0) return '0 MB';

  const megabytes = bytes / mebibyte;
  if (megabytes < 0.01) return '<0.01 MB';

  const value = bytes < gibibyte ? megabytes : bytes / gibibyte;
  const unit = bytes < gibibyte ? 'MB' : 'GB';
  return `${Number(value.toFixed(2))} ${unit}`;
}

export function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}
