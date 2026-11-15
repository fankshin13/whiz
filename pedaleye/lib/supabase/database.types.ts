
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "devices": {
                  Row: {
                    "accel_calib_max": number,"accel_calib_min": number,"brake_calib_max": number,"brake_calib_min": number,"created_at": string,"firmware_version": string,"hardware_rev": string,"id": string,"last_synced_at": string | null,"mac_address": string | null,"serial_number": string,"updated_at": string,"vehicle_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accel_calib_max"?: number,"accel_calib_min"?: number,"brake_calib_max"?: number,"brake_calib_min"?: number,"created_at"?: string,"firmware_version"?: string,"hardware_rev"?: string,"id"?: string,"last_synced_at"?: string | null,"mac_address"?: string | null,"serial_number": string,"updated_at"?: string,"vehicle_id"?: string | null
                  }
                  Update: {
                    "accel_calib_max"?: number,"accel_calib_min"?: number,"brake_calib_max"?: number,"brake_calib_min"?: number,"created_at"?: string,"firmware_version"?: string,"hardware_rev"?: string,"id"?: string,"last_synced_at"?: string | null,"mac_address"?: string | null,"serial_number"?: string,"updated_at"?: string,"vehicle_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "devices_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: true
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    }
                  ]
                },"event_sessions": {
                  Row: {
                    "created_at": string,"device_id": string,"end_time": string,"final_chain_hash": string,"id": string,"initial_chain_hash": string,"integrity_verified": boolean,"raw_log_storage_path": string | null,"record_count": number,"start_time": string,"trigger_type": Database["public"]['Enums']["trigger_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"device_id": string,"end_time": string,"final_chain_hash": string,"id"?: string,"initial_chain_hash": string,"integrity_verified"?: boolean,"raw_log_storage_path"?: string | null,"record_count"?: number,"start_time": string,"trigger_type": Database["public"]['Enums']["trigger_type"]
                  }
                  Update: {
                    "created_at"?: string,"device_id"?: string,"end_time"?: string,"final_chain_hash"?: string,"id"?: string,"initial_chain_hash"?: string,"integrity_verified"?: boolean,"raw_log_storage_path"?: string | null,"record_count"?: number,"start_time"?: string,"trigger_type"?: Database["public"]['Enums']["trigger_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_sessions_device_id_fkey"
      columns: ["device_id"]
isOneToOne: false
      referencedRelation: "devices"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"type": Database["public"]['Enums']["organization_type"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"type"?: Database["public"]['Enums']["organization_type"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"type"?: Database["public"]['Enums']["organization_type"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"users": {
                  Row: {
                    "created_at": string,"email": string,"id": string,"name": string,"org_id": string | null,"role": Database["public"]['Enums']["user_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"id": string,"name": string,"org_id"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"id"?: string,"name"?: string,"org_id"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "users_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"vehicles": {
                  Row: {
                    "assigned_user_id": string | null,"created_at": string,"id": string,"model_name": string,"model_year": number | null,"org_id": string,"plate_number": string,"updated_at": string,"vin_masked": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_user_id"?: string | null,"created_at"?: string,"id"?: string,"model_name": string,"model_year"?: number | null,"org_id": string,"plate_number": string,"updated_at"?: string,"vin_masked"?: string | null
                  }
                  Update: {
                    "assigned_user_id"?: string | null,"created_at"?: string,"id"?: string,"model_name"?: string,"model_year"?: number | null,"org_id"?: string,"plate_number"?: string,"updated_at"?: string,"vin_masked"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "vehicles_assigned_user_id_fkey"
      columns: ["assigned_user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicles_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "organization_type": "fleet"|"b2g"|"standard","trigger_type": "shock"|"sudden_accel"|"manual"|"periodic","user_role": "super_admin"|"org_admin"|"driver"|"investigator"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "organization_type": ["fleet", "b2g", "standard"],"trigger_type": ["shock", "sudden_accel", "manual", "periodic"],"user_role": ["super_admin", "org_admin", "driver", "investigator"]
          }
        }
} as const
