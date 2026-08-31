import { Link } from 'react-router-dom';
import { formatStorageSize } from '../utils/format.js';
import { Icon } from './Icons.jsx';
import { Logo } from './Logo.jsx';

const VIEWS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', to: '/dashboard' },
  { key: 'files', label: 'My Files', icon: 'files', to: '/dashboard?view=files' },
  { key: 'shared', label: 'Shared files', icon: 'globe', to: '/dashboard?view=shared' },
  { key: 'recent', label: 'Recent', icon: 'clock', to: '/dashboard?view=recent' },
  { key: 'favorites', label: 'Favorites', icon: 'star', to: '/dashboard?view=favorites' },
  { key: 'trash', label: 'Trash', icon: 'trash', to: '/dashboard?view=trash' },
];

export function DashboardSidebar({ activeView, open, stats, onClose, onNavigate, onSignOut }) {
  return (
    <aside className={`dashboard-sidebar${open ? ' is-open' : ''}`} id="dashboard-navigation">
      <div className="sidebar-brand-row">
        <Logo />
        <button type="button" className="sidebar-close" aria-label="Close navigation" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Dashboard sections">
        <p>Workspace</p>
        {VIEWS.map((view) => (
          <Link
            key={view.key}
            to={view.to}
            aria-current={activeView === view.key ? 'page' : undefined}
            onClick={() => {
              onNavigate();
              onClose();
            }}
          >
            <Icon name={view.icon} />
            <span>{view.label}</span>
          </Link>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <section className="sidebar-storage" aria-label="Vaulta storage allocation">
          <div>
            <span>Vaulta Storage</span>
            <strong>1 GB secure storage</strong>
          </div>
          {stats && (
            <>
              <div className="sidebar-storage-meta">
                <span>{formatStorageSize(stats.usedBytes)} used</span>
                <span>{formatStorageSize(stats.remainingBytes)} left</span>
              </div>
              <div
                className="sidebar-storage-progress"
                role="progressbar"
                aria-label="Sidebar storage used"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={stats.percentageUsed}
              >
                <span style={{ width: `${stats.percentageUsed}%` }} />
              </div>
            </>
          )}
        </section>
        <button type="button" className="sidebar-signout" onClick={onSignOut}>
          <Icon name="logout" /> Sign out
        </button>
      </div>
    </aside>
  );
}
