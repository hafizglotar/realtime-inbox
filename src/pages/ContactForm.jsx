import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function ContactForm() {
  const { agencySlug } = useParams();

  const [agency, setAgency] = useState(null);
  const [lookupState, setLookupState] = useState('loading'); // loading | ok | not_found | error

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitState, setSubmitState] = useState('idle'); // idle | submitting | sent | error
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('agencies')
        .select('id, name, slug')
        .eq('slug', agencySlug)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setLookupState('error');
        return;
      }
      if (!data) {
        setLookupState('not_found');
        return;
      }
      setAgency(data);
      setLookupState('ok');
    })();
    return () => {
      cancelled = true;
    };
  }, [agencySlug]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!agency) return;
    setSubmitState('submitting');
    setErrorMsg('');

    const { error } = await supabase.from('contacts').insert({
      agency_id: agency.id,
      name: name.trim(),
      email: email.trim(),
      message: message.trim(),
      // status is intentionally omitted; the column grant prevents anon from
      // setting it and the DB default ('new') applies.
    });

    if (error) {
      setSubmitState('error');
      setErrorMsg(error.message);
      return;
    }
    setSubmitState('sent');
    setName('');
    setEmail('');
    setMessage('');
  }

  if (lookupState === 'loading') {
    return <CenteredCard>Loading…</CenteredCard>;
  }
  if (lookupState === 'not_found') {
    return (
      <CenteredCard>
        <h1 className="text-lg font-semibold">Agency not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          The link <code className="rounded bg-slate-100 px-1">/c/{agencySlug}</code> doesn't
          match any agency.
        </p>
      </CenteredCard>
    );
  }
  if (lookupState === 'error') {
    return (
      <CenteredCard>
        <h1 className="text-lg font-semibold">Couldn't load this page</h1>
        <p className="mt-2 text-sm text-slate-600">Please try again in a moment.</p>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <h1 className="text-xl font-semibold">Contact {agency.name}</h1>
      <p className="mt-1 text-sm text-slate-500">
        Leave a message and an agent will get back to you.
      </p>

      {submitState === 'sent' ? (
        <div className="mt-6 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Thanks! Your message has been sent. You can submit another below if you'd like.
          <button
            className="ml-2 underline"
            onClick={() => setSubmitState('idle')}
          >
            New message
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field label="Name">
            <input
              type="text"
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              autoComplete="name"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              autoComplete="email"
            />
          </Field>
          <Field label="Message">
            <textarea
              required
              rows={5}
              maxLength={5000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className={inputCls}
            />
          </Field>

          {submitState === 'error' && (
            <p className="text-sm text-red-600">Something went wrong: {errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={submitState === 'submitting'}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {submitState === 'submitting' ? 'Sending…' : 'Send message'}
          </button>
        </form>
      )}
    </CenteredCard>
  );
}

const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function CenteredCard({ children }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}
