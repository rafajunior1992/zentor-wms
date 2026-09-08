import { useCallback, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { FactoryButton } from "./FactoryButton";
import { theme, spacing, typography } from "@/lib/theme";

interface BarcodeScannerProps {
  visible: boolean;
  title: string;
  hint?: string;
  onScan: (barcode: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({
  visible,
  title,
  hint,
  onScan,
  onClose,
}: BarcodeScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const [lastCode, setLastCode] = useState<string | null>(null);

  const handleBarcode = useCallback(
    ({ data }: { data: string }) => {
      if (scannedRef.current) return;
      scannedRef.current = true;
      setLastCode(data);
      onScan(data);
    },
    [onScan]
  );

  const resetScan = () => {
    scannedRef.current = false;
    setLastCode(null);
  };

  if (!visible) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Text style={styles.title}>{title}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}

        {!permission?.granted ? (
          <View style={styles.permissionBox}>
            <Text style={styles.permissionText}>
              Permissão de câmera necessária para bipar códigos.
            </Text>
            <FactoryButton
              label="Permitir câmera"
              onPress={requestPermission}
            />
          </View>
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: [
                  "ean13",
                  "ean8",
                  "code128",
                  "code39",
                  "qr",
                  "upc_a",
                  "upc_e",
                ],
              }}
              onBarcodeScanned={scannedRef.current ? undefined : handleBarcode}
            />
            <View style={styles.reticle} pointerEvents="none" />
          </View>
        )}

        {lastCode ? (
          <Text style={styles.lastCode}>Lido: {lastCode}</Text>
        ) : null}

        <View style={styles.actions}>
          <FactoryButton
            label="Bipar novamente"
            variant="secondary"
            onPress={resetScan}
          />
          <FactoryButton label="Fechar" variant="danger" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/** Botão que abre o scanner em modal */
export function ScanTriggerButton({
  label,
  onScan,
}: {
  label: string;
  onScan: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FactoryButton label={label} onPress={() => setOpen(true)} />
      <BarcodeScanner
        visible={open}
        title="Escanear código"
        onScan={(code) => {
          setOpen(false);
          onScan(code);
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
    padding: spacing.md,
    gap: spacing.md,
    paddingTop: spacing.xl,
  },
  title: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.text,
    textAlign: "center",
  },
  hint: {
    fontSize: typography.body,
    color: theme.textMuted,
    textAlign: "center",
  },
  cameraWrap: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: theme.primary,
  },
  camera: { flex: 1 },
  reticle: {
    ...StyleSheet.absoluteFill,
    margin: 48,
    borderWidth: 4,
    borderColor: theme.scannerOverlay,
    borderRadius: 12,
  },
  permissionBox: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.lg,
  },
  permissionText: {
    color: theme.text,
    fontSize: typography.body,
    textAlign: "center",
  },
  lastCode: {
    color: theme.success,
    fontSize: typography.subtitle,
    fontWeight: "700",
    textAlign: "center",
  },
  actions: { gap: spacing.sm },
});
