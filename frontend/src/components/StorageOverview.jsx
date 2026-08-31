import { formatStorageSize } from '../utils/format.js';
import { Icon } from './Icons.jsx';

const STAT_CARDS = [
  { key: 'totalFiles', label: 'Total files', icon: 'files' },
  { key: 'publicFiles', label: 'Public files', icon: 'globe', style: 'public' },
  { key: 'privateFiles', label: 'Private files', icon: 'lock', style: 'private' },
  { key: 'usedBytes', label: 'Storage used', icon: 'storage', bytes: true },
];

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
            <h2 id="storage-heading">Storage Overview</h2>
          </div>
          <span className="storage-card-icon"><Icon name="storage" /></span>
        </div>
        <div className="storage-visual-row">
          <div className="storage-ring" style={{ '--usage': `${stats.percentageUsed}%` }} role="img" aria-label={`${stats.percentageUsed}% of storage used`}>
            <span><strong>{stats.percentageUsed}%</strong><small>used</small></span>
          </div>
          <p className="storage-usage"><strong>{formatStorageSize(stats.usedBytes)}</strong><span> of {formatStorageSize(stats.quotaBytes)} used</span></p>
        </div>
        <div className="storage-progress-meta">
          <span>{stats.percentageUsed}% used</span>
          <span>{formatStorageSize(stats.remainingBytes)} remaining</span>
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
            <span className={`stat-icon stat-icon-${card.style || card.icon}`}><Icon name={card.icon} /></span>
            <div>
              <span>{card.label}</span>
              <strong>{card.bytes ? formatStorageSize(stats[card.key]) : stats[card.key].toLocaleString()}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
