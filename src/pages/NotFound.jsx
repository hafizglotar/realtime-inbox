import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">404</h1>
        <p className="mt-1 text-sm text-slate-500">This page doesn't exist.</p>
        <Link to="/login" className="mt-4 inline-block text-sm underline">
          Go to sign in
        </Link>
      </div>
    </div>
  );
}
