import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { queryClient } from "../lib/queryClient";

export type AccountRole = "user" | "admin" | "superadmin";
export type AccountStatus = "pending_verification" | "active" | "suspended";

export interface CurrentUser {
  id: string;
  handle: string;
  email: string | null;
  displayName: string | null;
  role: AccountRole;
  status: AccountStatus;
}

export function useCurrentUser() {
  const query = useQuery({
    queryKey: ["auth", "me"],
    retry: false,
    queryFn: async () => {
      const response = await fetch(apiUrl("/auth/me"), { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { user: CurrentUser };
      return body.user;
    },
  });

  return {
    user: query.data ?? null,
    isLoading: query.isLoading,
    refresh: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    logout: async () => {
      await fetch(apiUrl("/auth/logout"), { method: "POST", credentials: "include" });
      queryClient.setQueryData(["auth", "me"], null);
      queryClient.removeQueries({ queryKey: ["run"] });
      queryClient.removeQueries({ queryKey: ["projects"] });
    },
  };
}
