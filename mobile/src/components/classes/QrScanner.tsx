/**
 * Scans the class check-in QR with the back camera (expo-camera, in Expo Go and every build). Asks for the camera the
 * first time; a refusal leaves the typed code as the way in. Calls `onScan` once per opening with the raw text.
 * `.web.tsx` = the web preview: no camera, the typed code only.
 */
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { t } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Spinner, Text } from "@/ui";

export const scannerAvailable = true;

export function QrScanner({ onScan }: { onScan: (data: string) => void }) {
  const { theme } = useTheme();
  const [permission, request] = useCameraPermissions();
  const done = useRef(false);
  if (!permission) return <Spinner label={t("Abrindo a câmera")} />;
  if (!permission.granted) {
    return (
      <View style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.color.sunken }}>
        <Text tone="muted">{permission.canAskAgain
          ? t("Para ler o QR da aula, o Runflow precisa usar a câmera.")
          : t("A câmera está bloqueada para o Runflow. Libere nas configurações do celular ou digite o código.")}</Text>
        {permission.canAskAgain ? <Button variant="secondary" onPress={() => void request()}>{t("Permitir a câmera")}</Button> : null}
      </View>
    );
  }
  return (
    <View style={[styles.frame, { borderRadius: theme.radius.lg, height: theme.space[20] * 3 }]}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => { if (done.current) return; done.current = true; onScan(data); }} />
    </View>
  );
}

const styles = StyleSheet.create({ frame: { overflow: "hidden", width: "100%" } });
