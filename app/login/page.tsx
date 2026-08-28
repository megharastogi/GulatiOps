import LoginForm from './LoginForm';

// Signed-in-but-unauthorized users land back here with a reason. The
// no_household case is worth naming explicitly: it's what you see if the
// multi-household migration in schema.sql hasn't been applied yet, and
// without the message it looks like a silent redirect loop.
const NOTICES: Record<string, string> = {
  auth: 'That sign-in link is invalid or has expired. Request a new one.',
  no_household:
    'That account is not attached to a household yet. Ask Megha to add you.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <LoginForm notice={error ? NOTICES[error] : undefined} />
    </main>
  );
}
