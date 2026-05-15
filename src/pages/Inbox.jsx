import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

const STATUSES = ['new', 'contacted', 'discarded'];

const STATUS_BADGE = {
  new: 'bg-blue-50 text-blue-700 ring-blue-200',
  contacted: 'bg-amber-50 text-amber-700 ring-amber-200',
  discarded: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export default function Inbox() {
  const { session } = useAuth();
  // Map<id, contact> — keying by id is the dedup mechanism. Whether a row
  // arrives via the initial fetch or via realtime, .set(id, row) is idempotent.
  const [rowsById, setRowsById] = useState(() => new Map());
  const [loading, setLoading] = useState(true);
  const [agencyName, setAgencyName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    // Resolve which agency we belong to (purely for the header — RLS does the
    // real filtering on the contacts query).
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('agency_id, agencies(name)')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!cancelled && data?.agencies?.name) setAgencyName(data.agencies.name);
    })();

    // ---- Realtime first, then fetch -----------------------------------------
    // Subscribing before the initial select means any INSERT/UPDATE that lands
    // mid-fetch is captured by the channel and merged into the same Map. Same
    // id from both sources collapses to one row.
    const channel = supabase
      .channel('inbox-contacts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contacts' },
        (payload) => {
          // Realtime respects RLS, so we only get rows our agency can see.
          // For DELETE we'd remove by old.id, but DELETE is disabled by RLS.
          if (payload.eventType === 'DELETE') {
            setRowsById((prev) => {
              const next = new Map(prev);
              next.delete(payload.old.id);
              return next;
            });
            return;
          }
          const row = payload.new;
          setRowsById((prev) => {
            const next = new Map(prev);
            next.set(row.id, row);
            return next;
          });
        }
      )
      .subscribe(async (status) => {
        // Only run the initial fetch once the subscription is live. This
        // closes the race window: any event the server emits after this point
        // will be delivered to our handler, and the fetch below will see the
        // same row at most once.
        if (status !== 'SUBSCRIBED') return;

        const { data, error } = await supabase
          .from('contacts')
          .select('id, name, email, message, status, created_at, agency_id')
          .order('created_at', { ascending: false });

        if (cancelled) return;
        if (error) {
          setError(error.message);
          setLoading(false);
          return;
        }
        setRowsById((prev) => {
          const next = new Map(prev);
          for (const row of data) {
            // If realtime already inserted a fresher copy of this id, prefer
            // the one with the larger created_at / non-stale status. In
            // practice INSERT events carry the same row, so either wins.
            if (!next.has(row.id)) next.set(row.id, row);
          }
          return next;
        });
        setLoading(false);
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [session.user.id]);

  const rows = useMemo(() => {
    return Array.from(rowsById.values()).sort((a, b) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
    );
  }, [rowsById]);

  async function updateStatus(id, status) {
    // Optimistic update; revert on error.
    const prevRow = rowsById.get(id);
    setRowsById((prev) => {
      const next = new Map(prev);
      next.set(id, { ...prevRow, status });
      return next;
    });

    const { error } = await supabase
      .from('contacts')
      .update({ status })
      .eq('id', id);

    if (error) {
      setRowsById((prev) => {
        const next = new Map(prev);
        next.set(id, prevRow);
        return next;
      });
      alert(`Failed to update: ${error.message}`);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Inbox</h1>
          <p className="text-sm text-slate-500">
            {agencyName ? `${agencyName} · ` : ''}
            {session.user.email}
          </p>
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Sign out
        </button>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading inbox…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No contacts yet. Share your public form link.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_BADGE[c.status]}`}
                    >
                      {c.status}
                    </span>
                  </div>
                  <a
                    href={`mailto:${c.email}`}
                    className="text-sm text-slate-500 hover:underline"
                  >
                    {c.email}
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <time className="text-xs text-slate-400">
                    {formatDate(c.created_at)}
                  </time>
                  <select
                    value={c.status}
                    onChange={(e) => updateStatus(c.id, e.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                {c.message}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
