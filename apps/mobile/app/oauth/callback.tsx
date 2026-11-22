import { Redirect } from 'expo-router';
import { mobileRoutes } from '@archova/routes';
import { useSession } from '../../shared';

// `com.archova.app:/oauth/callback` is normally consumed by openAuthSessionAsync, but the OS also delivers it to the
// app as a deep link, and the router opens this screen. Nothing to render: signed-in people go home; everyone else
// goes to the sign-in screen (home is guarded and would be a blank page), where the sign-in result or error shows.
export default function OAuthCallback() {
  const { status } = useSession();
  if (status === 'loading') return null;
  return <Redirect href={status === 'signed_in' ? mobileRoutes.home() : '/sign-in'} />;
}
