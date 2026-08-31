import { formatBytes } from '../utils/format.js';

const STAT_CARDS = [
  { key: 'totalFiles', label: 'Total files', icon: 'files' },
  { key: 'publicFiles', label: 'Public files', icon: 'public' },
  { key: 'privateFiles', label: 'Private files', icon: 'private' },
  { key: 'usedBytes', label: 'Storage used', icon: 'storage', bytes: true },
];

function InsightIcon({ name }) {
  const paths = {
    files: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5M4 7v14h10" /></>,
    public: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.5 5.6 3.5 9s-1 6.4-3.5 9c-2.5-2.6-3.5-5.6-3.5-9S9.5 5.6 12 3z" /></>,
    private: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    storage: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function LoadingOverview() {
  return (
    <div className="dashboard-insights" role="status" aria-live="polite">
      <span className="sr-only">Loading storage overview…</span>
      <div className="storage-card storage-card-loading">
        <span className="skeleton skeleton-label" />
        <span className="skeleton skeleton-value" />
        <span className="skeleton skeleton-line" />
      </div>
      <div className="stats-grid">
        {STAT_CARDS.map((card) => <span className="stat-card skeleton-card" key={card.key} />)}
      </div>
    </div>
  );
}

export function StorageOverview({ stats, loading, refreshing, error, onRetry }) {
  if (loading && !stats) return <LoadingOverview />;

  if (!stats) {
    return (
      <section className="stats-error-card" aria-labelledby="storage-unavailable-heading">
        <div>
          <p className="eyebrow">Storage overview</p>
          <h2 id="storage-unavailable-heading">Storage insights are unavailable</h2>
          <p role="alert">{error || 'Vaulta could not load your storage statistics.'}</p>
        </div>
        <button type="button" className="button button-secondary" onClick={onRetry}>Retry</button>
      </section>
    );
  }

  return (
    <section className="dashboard-insights" aria-labelledby="storage-heading">
      <article className="storage-card">
        <div className="storage-card-heading">
          <div>
            <p className="eyebrow">Account allocation</p>
            <h2 id="storage-heading">Storage</h2>
          </div>
          <span className="storage-card-icon"><InsightIcon name="storage" /></span>
        </div>
        <p className="storage-usage">
          <strong>{formatBytes(stats.usedBytes)}</strong>
          <span> of {formatBytes(stats.quotaBytes)} used</span>
        </p>
        <div className="storage-progress-meta">
          <span>{stats.percentageUsed}% used</span>
          <span>{formatBytes(stats.remainingBytes)} remaining</span>
        </div>
        <div
          className="storage-progress"
          role="progressbar"
          aria-label="Account storage used"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={stats.percentageUsed}
        >
          <span style={{ width: `${stats.percentageUsed}%` }} />
        </div>
        <p className="storage-caption">
          Based on verified files in your vault.{refreshing ? ' Refreshing…' : ''}
        </p>
        {error && (
          <div className="stats-refresh-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={onRetry}>Retry</button>
          </div>
        )}
      </article>

      <div className="stats-grid" aria-label="File statistics">
        {STAT_CARDS.map((card) => (
          <article className="stat-card" key={card.key}>
            <span className={`stat-icon stat-icon-${card.icon}`}><InsightIcon name={card.icon} /></span>
            <div>
              <span>{card.label}</span>
              <strong>{card.bytes ? formatBytes(stats[card.key]) : stats[card.key].toLocaleString()}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
