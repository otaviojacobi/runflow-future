/** `/`: signed in → the role's home in the active club (no club yet: the club list); signed out → sign-in. */
import { Redirect } from "expo-router";
import { StyleSheet } from "react-native";
import { homeFor, useClub } from "@/lib/club";
import { useSession } from "@/lib/session";
import { Screen, Spinner } from "@/ui";

export default function Index() {
  const { signedIn } = useSession();
  const { me, meQuery, role } = useClub();
  if (!signedIn) return <Redirect href="/login" />;
  // `/me` is cached from the sign-in; without it (a cleared cache) wait for it, or let the club list explain an error.
  if (!me && !meQuery.isError) return <Screen insetTop contentStyle={styles.center}><Spinner /></Screen>;
  return <Redirect href={homeFor(role)} />;
}

const styles = StyleSheet.create({ center: { flexGrow: 1, alignItems: "center", justifyContent: "center" } });
