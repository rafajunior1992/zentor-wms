import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "@/components/AuthGate";
import { AuthProvider } from "@/contexts/AuthContext";
import { appStackScreenOptions } from "@/lib/navigation";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 3_000 },
  },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate>
          <StatusBar style="light" />
          <Stack screenOptions={appStackScreenOptions}>
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen
              name="picking"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="wave-picking"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="correcao/index"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ressuprimento/index"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="armazenagem-pulmao/index"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="cargo-transport/index"
              options={{ title: "Transporte de carga" }}
            />
            <Stack.Screen
              name="stocking/index"
              options={{ title: "Abastecer estoque" }}
            />
            <Stack.Screen
              name="replenishment/index"
              options={{ title: "Solicitar reabastecimento" }}
            />
            <Stack.Screen
              name="purchase-receipt"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="putaway"
              options={{ headerShown: false }}
            />
            <Stack.Screen name="perfil" options={{ title: "Meu perfil" }} />
            <Stack.Screen
              name="notifications"
              options={{ title: "Notificações" }}
            />
          </Stack>
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  );
}
