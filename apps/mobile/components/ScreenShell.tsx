import { SafeAreaView } from "react-native-safe-area-context";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewProps,
} from "react-native";
import { BackButton } from "@/components/BackButton";
import { theme, spacing, typography } from "@/lib/theme";

/** Padding horizontal padrão das telas com ScreenShell */
export const screenPadding = spacing.md;

interface ScreenShellProps extends ViewProps {
  title?: string;
  subtitle?: string;
  /** Conteúdo rolável quando passa da altura da tela */
  scroll?: boolean;
  /** Exibe seta de voltar para a tela inicial (sem texto) */
  backToHome?: boolean;
  children: React.ReactNode;
}

export function ScreenShell({
  title,
  subtitle,
  scroll = false,
  backToHome = false,
  children,
  style,
  ...rest
}: ScreenShellProps) {
  const content = (
    <>
      {backToHome ? (
        <View style={styles.backRow}>
          <BackButton color={theme.text} />
        </View>
      ) : null}
      {title || subtitle ? (
        <View style={styles.header}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      ) : null}
      {children}
    </>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, style]}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator
          {...rest}
        >
          {content}
        </ScrollView>
      ) : (
        <View style={[styles.container, style]} {...rest}>
          {content}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  container: {
    flex: 1,
    padding: screenPadding,
    gap: spacing.md,
  },
  scrollContent: {
    flexGrow: 1,
    padding: screenPadding,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  backRow: {
    alignSelf: "flex-start",
    marginBottom: spacing.md,
  },
  header: { gap: spacing.xs, marginBottom: spacing.sm },
  title: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.text,
  },
  subtitle: {
    fontSize: typography.body,
    color: theme.textMuted,
    fontWeight: "600",
  },
});
