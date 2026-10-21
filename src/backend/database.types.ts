export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          client_id: string
          distance_m: number
          elapsed_ms: number
          ended_at: string
          excluded_m: number
          flags: string[]
          group_session_id: string | null
          id: string
          is_loop: boolean
          kind: Database["public"]["Enums"]["activity_kind"]
          leaderboard_eligible: boolean
          month_start: string
          moving_ms: number
          public_path: unknown
          received_at: string
          share_route: boolean
          started_at: string
          status: Database["public"]["Enums"]["activity_status"]
          user_id: string
          week_start: string
        }
        Insert: {
          client_id: string
          distance_m: number
          elapsed_ms: number
          ended_at: string
          excluded_m?: number
          flags?: string[]
          group_session_id?: string | null
          id?: string
          is_loop?: boolean
          kind: Database["public"]["Enums"]["activity_kind"]
          leaderboard_eligible: boolean
          month_start: string
          moving_ms: number
          public_path?: unknown
          received_at?: string
          share_route?: boolean
          started_at: string
          status: Database["public"]["Enums"]["activity_status"]
          user_id: string
          week_start: string
        }
        Update: {
          client_id?: string
          distance_m?: number
          elapsed_ms?: number
          ended_at?: string
          excluded_m?: number
          flags?: string[]
          group_session_id?: string | null
          id?: string
          is_loop?: boolean
          kind?: Database["public"]["Enums"]["activity_kind"]
          leaderboard_eligible?: boolean
          month_start?: string
          moving_ms?: number
          public_path?: unknown
          received_at?: string
          share_route?: boolean
          started_at?: string
          status?: Database["public"]["Enums"]["activity_status"]
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_group_session_id_fkey"
            columns: ["group_session_id"]
            isOneToOne: false
            referencedRelation: "group_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_efforts: {
        Row: {
          activity_id: string
          distance_m: number
          duration_ms: number
          eligible: boolean
          month_start: string
          start_offset_ms: number
          user_id: string
          week_start: string
        }
        Insert: {
          activity_id: string
          distance_m: number
          duration_ms: number
          eligible: boolean
          month_start: string
          start_offset_ms: number
          user_id: string
          week_start: string
        }
        Update: {
          activity_id?: string
          distance_m?: number
          duration_ms?: number
          eligible?: boolean
          month_start?: string
          start_offset_ms?: number
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_efforts_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_efforts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_traces: {
        Row: {
          activity_id: string
          created_at: string
          path: unknown
          user_id: string
        }
        Insert: {
          activity_id: string
          created_at?: string
          path: unknown
          user_id: string
        }
        Update: {
          activity_id?: string
          created_at?: string
          path?: unknown
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_traces_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: true
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_traces_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          created_at: string
          requested_by: string
          responded_at: string | null
          status: string
          user_a: string
          user_b: string
        }
        Insert: {
          created_at?: string
          requested_by: string
          responded_at?: string | null
          status: string
          user_a: string
          user_b: string
        }
        Update: {
          created_at?: string
          requested_by?: string
          responded_at?: string | null
          status?: string
          user_a?: string
          user_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_user_a_fkey"
            columns: ["user_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_user_b_fkey"
            columns: ["user_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          group_id: string
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          group_id: string
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          group_id?: string
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_session_participants: {
        Row: {
          joined_at: string
          session_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          session_id: string
          user_id: string
        }
        Update: {
          joined_at?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_session_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "group_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_session_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_sessions: {
        Row: {
          created_at: string
          created_by: string | null
          ended_at: string | null
          group_id: string
          id: string
          kind: Database["public"]["Enums"]["activity_kind"]
          started_at: string | null
          starts_at: string | null
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          group_id: string
          id?: string
          kind?: Database["public"]["Enums"]["activity_kind"]
          started_at?: string | null
          starts_at?: string | null
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          group_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["activity_kind"]
          started_at?: string | null
          starts_at?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_sessions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          id: string
          invite_code: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invite_code: string
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invite_code?: string
          name?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboard_archive: {
        Row: {
          board: string
          period: string
          period_start: string
          rank: number
          user_id: string
          value: number
        }
        Insert: {
          board: string
          period: string
          period_start: string
          rank: number
          user_id: string
          value: number
        }
        Update: {
          board?: string
          period?: string
          period_start?: string
          rank?: number
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_archive_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          kind: string
          payload: Json
          push_attempts: number
          push_state: string
          read_at: string | null
          recipient_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          kind: string
          payload?: Json
          push_attempts?: number
          push_state?: string
          read_at?: string | null
          recipient_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          kind?: string
          payload?: Json
          push_attempts?: number
          push_state?: string
          read_at?: string | null
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_private: {
        Row: {
          age_confirmed_at: string
          invite_code: string
          nickname_changed_at: string
          notify_friend_requests: boolean
          notify_overtake: boolean
          notify_sessions: boolean
          territory_notice_at: string | null
          territory_opt_in: boolean
          user_id: string
        }
        Insert: {
          age_confirmed_at: string
          invite_code: string
          nickname_changed_at?: string
          notify_friend_requests?: boolean
          notify_overtake?: boolean
          notify_sessions?: boolean
          territory_notice_at?: string | null
          territory_opt_in?: boolean
          user_id: string
        }
        Update: {
          age_confirmed_at?: string
          invite_code?: string
          nickname_changed_at?: string
          notify_friend_requests?: boolean
          notify_overtake?: boolean
          notify_sessions?: boolean
          territory_notice_at?: string | null
          territory_opt_in?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_private_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          color: number
          created_at: string
          id: string
          nickname: string
        }
        Insert: {
          color?: number
          created_at?: string
          id: string
          nickname: string
        }
        Update: {
          color?: number
          created_at?: string
          id?: string
          nickname?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      territory_cells: {
        Row: {
          activity_id: string
          cell_id: number
          claimed_at: string
          month_start: string
          owner_id: string
        }
        Insert: {
          activity_id: string
          cell_id: number
          claimed_at: string
          month_start: string
          owner_id: string
        }
        Update: {
          activity_id?: string
          cell_id?: number
          claimed_at?: string
          month_start?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "territory_cells_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territory_cells_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      territory_champions: {
        Row: {
          cells: number
          month_start: string
          rank: number
          user_id: string
        }
        Insert: {
          cells: number
          month_start: string
          rank: number
          user_id: string
        }
        Update: {
          cells?: number
          month_start?: string
          rank?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "territory_champions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      territory_claims: {
        Row: {
          activity_id: string
          area_m2: number
          cells_claimed: number
          cells_stolen: number
          created_at: string
          month_start: string
          user_id: string
        }
        Insert: {
          activity_id: string
          area_m2: number
          cells_claimed: number
          cells_stolen: number
          created_at?: string
          month_start: string
          user_id: string
        }
        Update: {
          activity_id?: string
          area_m2?: number
          cells_claimed?: number
          cells_stolen?: number
          created_at?: string
          month_start?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "territory_claims_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: true
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territory_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      block_user: { Args: { p_other: string }; Returns: undefined }
      claim_nickname: {
        Args: { p_age_confirmed?: boolean; p_nickname: string }
        Returns: Json
      }
      create_group: { Args: { p_name: string }; Returns: string }
      create_group_session: {
        Args: {
          p_group: string
          p_kind?: Database["public"]["Enums"]["activity_kind"]
          p_starts_at?: string
          p_title: string
        }
        Returns: string
      }
      delete_activity: { Args: { p_activity: string }; Returns: undefined }
      delete_my_account: { Args: never; Returns: undefined }
      get_activity_claim: { Args: { p_activity: string }; Returns: Json }
      get_champions: {
        Args: { p_period: string; p_period_start: string }
        Returns: {
          board: string
          color: number
          nickname: string
          rank: number
          user_id: string
          value: number
        }[]
      }
      get_featured_runs: {
        Args: { p_limit?: number; p_period: string; p_period_start?: string }
        Returns: {
          achieved_on: string
          activity_id: string
          color: number
          duration_ms: number
          effort_m: number
          nickname: string
          route_polyline: string
          total_m: number
        }[]
      }
      get_group_members: {
        Args: { p_group: string }
        Returns: {
          color: number
          joined_at: string
          nickname: string
          role: string
          user_id: string
        }[]
      }
      get_group_session: { Args: { p_session: string }; Returns: Json }
      get_leaderboard: {
        Args: {
          p_board: string
          p_group_id?: string
          p_limit?: number
          p_period: string
          p_period_start?: string
          p_scope?: string
        }
        Returns: {
          achieved_on: string
          activity_id: string
          color: number
          is_me: boolean
          nickname: string
          rank: number
          user_id: string
          value: number
        }[]
      }
      get_my_activity_track: { Args: { p_activity: string }; Returns: string }
      get_my_profile: { Args: never; Returns: Json }
      get_session_results: {
        Args: { p_session: string }
        Returns: {
          activity_status: string
          best_1k_ms: number
          best_5k_ms: number
          color: number
          distance_m: number
          elapsed_ms: number
          moving_ms: number
          nickname: string
          user_id: string
        }[]
      }
      get_territory: {
        Args: {
          p_after?: number
          p_east: number
          p_limit?: number
          p_month?: string
          p_north: number
          p_south: number
          p_west: number
        }
        Returns: {
          cell_id: number
          color: number
          nickname: string
          owner_id: string
        }[]
      }
      get_territory_standings: {
        Args: { p_limit?: number; p_month?: string }
        Returns: {
          cells: number
          color: number
          is_me: boolean
          nickname: string
          rank: number
          user_id: string
        }[]
      }
      join_group: { Args: { p_code: string }; Returns: string }
      join_group_session: { Args: { p_session: string }; Returns: undefined }
      leave_group: { Args: { p_group: string }; Returns: undefined }
      list_friends: {
        Args: never
        Returns: {
          color: number
          nickname: string
          since: string
          status: string
          user_id: string
          week_run_m: number
        }[]
      }
      list_my_activities: {
        Args: { p_before?: string; p_limit?: number }
        Returns: Json[]
      }
      list_my_groups: {
        Args: never
        Returns: {
          created_at: string
          id: string
          invite_code: string
          member_count: number
          name: string
          role: string
        }[]
      }
      mark_notifications_read: { Args: { p_ids: string[] }; Returns: undefined }
      register_push_token: {
        Args: { p_platform: string; p_token: string }
        Returns: undefined
      }
      remove_friend: { Args: { p_other: string }; Returns: undefined }
      remove_group_member: {
        Args: { p_group: string; p_user: string }
        Returns: undefined
      }
      respond_friend_request: {
        Args: { p_accept: boolean; p_other: string }
        Returns: undefined
      }
      rotate_group_code: { Args: { p_group: string }; Returns: string }
      rotate_invite_code: { Args: never; Returns: string }
      send_friend_request: {
        Args: { p_code?: string; p_nickname?: string }
        Returns: string
      }
      set_activity_sharing: {
        Args: { p_activity: string; p_share: boolean }
        Returns: Json
      }
      set_group_session_status: {
        Args: { p_session: string; p_status: string }
        Returns: undefined
      }
      set_my_settings: { Args: { p: Json }; Returns: Json }
      submit_activity: { Args: { p: Json }; Returns: Json }
      unregister_push_token: { Args: { p_token: string }; Returns: undefined }
    }
    Enums: {
      activity_kind: "run" | "bike"
      activity_status: "valid" | "flagged"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_kind: ["run", "bike"],
      activity_status: ["valid", "flagged"],
    },
  },
} as const
