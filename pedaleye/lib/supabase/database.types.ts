
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
            "audit_logs": {
                  Row: {
                    "action_type": Database["public"]['Enums']["audit_action_type"],"actor_id": string | null,"actor_name": string,"actor_role": Database["public"]['Enums']["user_role"] | null,"changes_summary": NonNullable<Json>,"created_at": string,"id": string,"ip_address": string,"org_id": string | null,"status": Database["public"]['Enums']["audit_status"],"target_display_name": string,"target_id": string,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action_type": Database["public"]['Enums']["audit_action_type"],"actor_id"?: string | null,"actor_name": string,"actor_role"?: Database["public"]['Enums']["user_role"] | null,"changes_summary"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"ip_address"?: string,"org_id"?: string | null,"status"?: Database["public"]['Enums']["audit_status"],"target_display_name": string,"target_id": string,"target_type": string
                  }
                  Update: {
                    "action_type"?: Database["public"]['Enums']["audit_action_type"],"actor_id"?: string | null,"actor_name"?: string,"actor_role"?: Database["public"]['Enums']["user_role"] | null,"changes_summary"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"ip_address"?: string,"org_id"?: string | null,"status"?: Database["public"]['Enums']["audit_status"],"target_display_name"?: string,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [
                    
                  ]
                },"devices": {
                  Row: {
                    "accel_calib_max": number,"accel_calib_min": number,"auth_public_key": string | null,"brake_calib_max": number,"brake_calib_min": number,"created_at": string,"firmware_version": string,"hardware_rev": string,"id": string,"last_synced_at": string | null,"mac_address": string | null,"org_id": string | null,"serial_number": string,"updated_at": string,"vehicle_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accel_calib_max"?: number,"accel_calib_min"?: number,"auth_public_key"?: string | null,"brake_calib_max"?: number,"brake_calib_min"?: number,"created_at"?: string,"firmware_version"?: string,"hardware_rev"?: string,"id"?: string,"last_synced_at"?: string | null,"mac_address"?: string | null,"org_id"?: string | null,"serial_number": string,"updated_at"?: string,"vehicle_id"?: string | null
                  }
                  Update: {
                    "accel_calib_max"?: number,"accel_calib_min"?: number,"auth_public_key"?: string | null,"brake_calib_max"?: number,"brake_calib_min"?: number,"created_at"?: string,"firmware_version"?: string,"hardware_rev"?: string,"id"?: string,"last_synced_at"?: string | null,"mac_address"?: string | null,"org_id"?: string | null,"serial_number"?: string,"updated_at"?: string,"vehicle_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "devices_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "devices_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: true
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    }
                  ]
                },"event_sessions": {
                  Row: {
                    "created_at": string,"device_id": string,"device_seal_signature": string | null,"device_seal_verified": boolean,"device_session_index": number | null,"end_time": string,"final_chain_hash": string,"id": string,"initial_chain_hash": string,"integrity_verified": boolean,"raw_log_storage_path": string | null,"record_count": number,"start_time": string,"trigger_type": Database["public"]['Enums']["trigger_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"device_id": string,"device_seal_signature"?: string | null,"device_seal_verified"?: boolean,"device_session_index"?: number | null,"end_time": string,"final_chain_hash": string,"id"?: string,"initial_chain_hash": string,"integrity_verified"?: boolean,"raw_log_storage_path"?: string | null,"record_count"?: number,"start_time": string,"trigger_type": Database["public"]['Enums']["trigger_type"]
                  }
                  Update: {
                    "created_at"?: string,"device_id"?: string,"device_seal_signature"?: string | null,"device_seal_verified"?: boolean,"device_session_index"?: number | null,"end_time"?: string,"final_chain_hash"?: string,"id"?: string,"initial_chain_hash"?: string,"integrity_verified"?: boolean,"raw_log_storage_path"?: string | null,"record_count"?: number,"start_time"?: string,"trigger_type"?: Database["public"]['Enums']["trigger_type"]
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
                },"invitations": {
                  Row: {
                    "accepted_user_id": string | null,"created_at": string,"created_by": string,"email": string,"expires_at": string,"id": string,"invitee_name": string,"org_id": string,"revoked_at": string | null,"revoked_by": string | null,"role": Database["public"]['Enums']["user_role"],"token_hash": string,"updated_at": string,"used_at": string | null,"vehicle_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_user_id"?: string | null,"created_at"?: string,"created_by": string,"email": string,"expires_at": string,"id"?: string,"invitee_name": string,"org_id": string,"revoked_at"?: string | null,"revoked_by"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"token_hash": string,"updated_at"?: string,"used_at"?: string | null,"vehicle_id"?: string | null
                  }
                  Update: {
                    "accepted_user_id"?: string | null,"created_at"?: string,"created_by"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invitee_name"?: string,"org_id"?: string,"revoked_at"?: string | null,"revoked_by"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"token_hash"?: string,"updated_at"?: string,"used_at"?: string | null,"vehicle_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_accepted_user_id_fkey"
      columns: ["accepted_user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
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
                    "created_at": string,"deactivated_at": string | null,"deactivated_by": string | null,"email": string,"id": string,"is_active": boolean,"name": string,"org_id": string | null,"role": Database["public"]['Enums']["user_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deactivated_at"?: string | null,"deactivated_by"?: string | null,"email": string,"id": string,"is_active"?: boolean,"name": string,"org_id"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"deactivated_at"?: string | null,"deactivated_by"?: string | null,"email"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"org_id"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "users_deactivated_by_fkey"
      columns: ["deactivated_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
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
            "accept_invitation":
{ Args: { "p_token_hash": string,"p_user_id": string }; Returns: Database["public"]['Enums']["user_role"]
                           },
"assign_driver":
{ Args: { "p_reason"?: string,"p_user_id": string,"p_vehicle_id": string }; Returns: Json
                           },
"log_admin_audit_event":
{ Args: { "p_action_type": Database["public"]['Enums']["audit_action_type"],"p_changes_summary"?: Json,"p_status"?: Database["public"]['Enums']["audit_status"],"p_target_display_name"?: string,"p_target_id": string,"p_target_type": string }; Returns: string
                           },
"mount_device":
{ Args: { "p_device_id": string,"p_replace"?: boolean,"p_vehicle_id": string }; Returns: Json
                           },
"reissue_invitation":
{ Args: { "p_expires_in_hours": number,"p_invitation_id": string,"p_token_hash": string }; Returns: Json
                           },
"revoke_invitation":
{ Args: { "p_invitation_id": string,"p_reason"?: string }; Returns: Json
                           },
"set_device_public_key":
{ Args: { "p_device_id": string,"p_public_key": string,"p_reason": string }; Returns: Json
                           },
"set_user_active":
{ Args: { "p_active": boolean,"p_demote"?: boolean,"p_reason"?: string,"p_unassign_vehicle"?: boolean,"p_user_id": string }; Returns: Json
                           },
"user_last_sign_in":
{ Args: { "p_user_ids": (string)[] }; Returns: {
              "id": string,"last_sign_in_at": string
            }[]
                           }
          }
          Enums: {
            "audit_action_type": "ORG_CREATE"|"ORG_UPDATE"|"ORG_DELETE"|"VEHICLE_CREATE"|"VEHICLE_UPDATE"|"VEHICLE_DRIVER_UNASSIGN"|"VEHICLE_DELETE"|"DEVICE_CREATE"|"DEVICE_MOUNT"|"DEVICE_REPLACE"|"DEVICE_UNMOUNT"|"DEVICE_CALIBRATE"|"DEVICE_UPDATE"|"DEVICE_DELETE"|"INVITATION_CREATE"|"INVITATION_ACCEPT"|"INVITATION_CANCEL"|"INVITATION_DELETE"|"USER_DEACTIVATE"|"USER_REACTIVATE"|"USER_ROLE_CHANGE"|"REPORT_VIEW"|"REPORT_DOWNLOAD"|"DEVICE_KEY_REGISTER"|"DEVICE_KEY_UPDATE"|"DEVICE_KEY_REVOKE"|"VEHICLE_DRIVER_ASSIGN","audit_status": "SUCCESS"|"DENIED","organization_type": "fleet"|"b2g"|"standard","trigger_type": "shock"|"sudden_accel"|"manual"|"periodic","user_role": "super_admin"|"org_admin"|"driver"|"investigator"
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
            "audit_action_type": ["ORG_CREATE", "ORG_UPDATE", "ORG_DELETE", "VEHICLE_CREATE", "VEHICLE_UPDATE", "VEHICLE_DRIVER_UNASSIGN", "VEHICLE_DELETE", "DEVICE_CREATE", "DEVICE_MOUNT", "DEVICE_REPLACE", "DEVICE_UNMOUNT", "DEVICE_CALIBRATE", "DEVICE_UPDATE", "DEVICE_DELETE", "INVITATION_CREATE", "INVITATION_ACCEPT", "INVITATION_CANCEL", "INVITATION_DELETE", "USER_DEACTIVATE", "USER_REACTIVATE", "USER_ROLE_CHANGE", "REPORT_VIEW", "REPORT_DOWNLOAD", "DEVICE_KEY_REGISTER", "DEVICE_KEY_UPDATE", "DEVICE_KEY_REVOKE", "VEHICLE_DRIVER_ASSIGN"],"audit_status": ["SUCCESS", "DENIED"],"organization_type": ["fleet", "b2g", "standard"],"trigger_type": ["shock", "sudden_accel", "manual", "periodic"],"user_role": ["super_admin", "org_admin", "driver", "investigator"]
          }
        }
} as const
