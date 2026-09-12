import { useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { userInitials } from "@/lib/avatar";
import { theme, spacing, typography } from "@/lib/theme";

export function UserAvatarMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  const initials = userInitials(user.name);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.avatar}
        accessibilityLabel="Menu do usuário"
      >
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.initials}>{initials}</Text>
        )}
      </Pressable>

      <Modal visible={open} transparent animationType="fade">
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
            accessibilityLabel="Fechar menu"
          />
          <View style={styles.menu}>
            <Text style={styles.name}>{user.name}</Text>
            <Text style={styles.email}>{user.email}</Text>
            <Pressable
              style={styles.item}
              onPress={() => {
                setOpen(false);
                router.push("/perfil");
              }}
            >
              <Text style={styles.itemText}>Meu perfil</Text>
            </Pressable>
            <Pressable
              style={[styles.item, styles.itemDanger]}
              onPress={() => {
                setOpen(false);
                void logout().then(() => router.replace("/login"));
              }}
            >
              <Text style={styles.itemDangerText}>Sair</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: theme.primary,
    backgroundColor: theme.surface,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  initials: {
    fontWeight: "800",
    color: theme.primary,
    fontSize: typography.body,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 56,
    paddingRight: spacing.md,
  },
  menu: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    minWidth: 200,
    borderWidth: 1,
    borderColor: theme.border,
  },
  name: { fontWeight: "800", fontSize: typography.body, color: theme.text },
  email: {
    color: theme.textMuted,
    fontSize: typography.caption,
    marginBottom: spacing.sm,
  },
  item: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  itemText: { fontSize: typography.body, fontWeight: "600", color: theme.text },
  itemDanger: {},
  itemDangerText: {
    fontSize: typography.body,
    fontWeight: "700",
    color: theme.danger,
  },
});
