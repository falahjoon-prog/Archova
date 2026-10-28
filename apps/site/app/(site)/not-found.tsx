import Link from 'next/link';

export default function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p>
        That page isn&apos;t here. <Link href="/">Back to the home page</Link>.
      </p>
    </>
  );
}
