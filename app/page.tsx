'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApprovalsPanel } from '../components/ApprovalsPanel';
import { QueueTable } from '../components/QueueTable';
import { ApprovalsResponseSchema, type ApprovalItem } from '../shared/schemas';

export default function Page() {
  const [items, setItems] = useState<ApprovalItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const res = await fetch('/api/approvals', { signal });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const parsed = ApprovalsResponseSchema.parse(await res.json());
      setItems(parsed.items);
    } catch (e) {
      if (signal?.aborted) return;
      setError('Could not load the approvals queue.');
    }
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    void load(ctl.signal);
    return () => ctl.abort();
  }, [load]);

  return (
    <main className="page">
      <header className="page__header">
        <h1>Approvals &amp; Review</h1>
        <p className="muted">Demo dashboard. Open the assistant at the bottom right.</p>
      </header>
      <QueueTable items={items} error={error} onRetry={() => void load()} />
      <ApprovalsPanel itemCount={items?.length ?? null} />
    </main>
  );
}
