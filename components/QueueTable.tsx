'use client';

import type { ApprovalItem } from '../shared/schemas';

const TYPE_LABEL: Record<ApprovalItem['type'], string> = { folder: 'Folder', video: 'Video', pdf: 'Pdf', image: 'Image' };

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

interface Props {
  items: ApprovalItem[] | null;
  error: string | null;
  onRetry: () => void;
}

export function QueueTable({ items, error, onRetry }: Props) {
  return (
    <section className="queue" aria-label="Pending approval requests">
      <div className="queue__head">
        <h2>Pending approval requests</h2>
        {items && <span className="pill">{items.length} items</span>}
      </div>
      {error && (
        <div className="errorbox" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn--small" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {!error && items === null && <p className="muted" role="status">Loading queue…</p>}
      {items && items.length === 0 && <p className="empty">No pending approvals. You&apos;re all caught up.</p>}
      {items && items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Folder / content name</th>
              <th scope="col">Type</th>
              <th scope="col">Submitted by</th>
              <th scope="col">Date</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  <strong>{i.title}</strong>
                  <div className="muted">{i.path}</div>
                </td>
                <td>
                  <span className="pill pill--type">{TYPE_LABEL[i.type]}</span>
                </td>
                <td>{i.submittedBy}</td>
                <td>{formatDate(i.submittedOn)}</td>
                <td>
                  <span className="pill pill--pending">Pending Review</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
