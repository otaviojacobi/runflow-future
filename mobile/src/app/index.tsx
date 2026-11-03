/** `/`: signed in → the role's home in the active club; signed out → sign-in. */
import { Redirect } from "expo-router";
import { activeMembership, homeFor } from "@/lib/club";
import { useSession } from "@/lib/session";

export default function Index() {
  const { signedIn, me, clubId } = useSession();
  if (!signedIn) return <Redirect href="/login" />;
  return <Redirect href={homeFor(activeMembership(me, clubId)?.membership.role)} />;
}
