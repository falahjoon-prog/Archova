import { Redirect } from 'expo-router';
import { mobileRoutes } from '@archova/routes';

// `com.archova.app:/oauth/callback` is normally consumed by openAuthSessionAsync. If the OS delivers it to the app
// as a deep link instead (e.g. the auth session was dismissed), there is nothing to render: go home, and the
// navigator's guards send signed-out users to sign-in.
export default function OAuthCallback() {
  return <Redirect href={mobileRoutes.home()} />;
}
