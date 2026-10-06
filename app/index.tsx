// Navigation is handled entirely by the auth guard in app/_layout.tsx.
// Returning null prevents the unconditional redirect to /(auth)/login
// that caused a brief login-screen flash for already-authenticated users.
export default function Index() {
  return null;
}
