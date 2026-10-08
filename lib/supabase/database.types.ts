// Generated from the database schema (Supabase `generate_typescript_types`),
// with the generated helper types reduced to `Tables` below. Regenerate after
// each migration.

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
      analyses: {
        Row: {
          adapter: string | null
          commit_sha: string | null
          coverage: Json | null
          created_at: string
          created_by: string | null
          edge_count: number | null
          error: string | null
          excluded: Json | null
          files_parsed: number | null
          files_total: number | null
          finished_at: string | null
          id: string
          org_id: string
          project_id: string
          stage: string | null
          stage_at: string | null
          stage_message: string | null
          started_at: string | null
          status: string
          unresolved: Json | null
        }
        Insert: {
          adapter?: string | null
          commit_sha?: string | null
          coverage?: Json | null
          created_at?: string
          created_by?: string | null
          edge_count?: number | null
          error?: string | null
          excluded?: Json | null
          files_parsed?: number | null
          files_total?: number | null
          finished_at?: string | null
          id?: string
          org_id: string
          project_id: string
          stage?: string | null
          stage_at?: string | null
          stage_message?: string | null
          started_at?: string | null
          status?: string
          unresolved?: Json | null
        }
        Update: {
          adapter?: string | null
          commit_sha?: string | null
          coverage?: Json | null
          created_at?: string
          created_by?: string | null
          edge_count?: number | null
          error?: string | null
          excluded?: Json | null
          files_parsed?: number | null
          files_total?: number | null
          finished_at?: string | null
          id?: string
          org_id?: string
          project_id?: string
          stage?: string | null
          stage_at?: string | null
          stage_message?: string | null
          started_at?: string | null
          status?: string
          unresolved?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "analyses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyses_project_id_org_id_fkey"
            columns: ["project_id", "org_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      edges: {
        Row: {
          analysis_id: string
          id: number
          kind: string
          line: number | null
          org_id: string
          source_file_id: string
          specifier: string
          target_file_id: string
          type_only: boolean
        }
        Insert: {
          analysis_id: string
          id?: never
          kind: string
          line?: number | null
          org_id: string
          source_file_id: string
          specifier: string
          target_file_id: string
          type_only?: boolean
        }
        Update: {
          analysis_id?: string
          id?: never
          kind?: string
          line?: number | null
          org_id?: string
          source_file_id?: string
          specifier?: string
          target_file_id?: string
          type_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "edges_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "edges_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_source_file_id_analysis_id_fkey"
            columns: ["source_file_id", "analysis_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id"]
          },
          {
            foreignKeyName: "edges_target_file_id_analysis_id_fkey"
            columns: ["target_file_id", "analysis_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id"]
          },
        ]
      }
      explanations: {
        Row: {
          body: string
          cache_key: string
          created_at: string
          model: string
          org_id: string
          subject: string
        }
        Insert: {
          body: string
          cache_key: string
          created_at?: string
          model: string
          org_id: string
          subject: string
        }
        Update: {
          body?: string
          cache_key?: string
          created_at?: string
          model?: string
          org_id?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "explanations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      file_roles: {
        Row: {
          analysis_id: string
          file_id: string
          id: string
          org_id: string
          role: string
          source: string
        }
        Insert: {
          analysis_id: string
          file_id: string
          id?: string
          org_id: string
          role: string
          source: string
        }
        Update: {
          analysis_id?: string
          file_id?: string
          id?: string
          org_id?: string
          role?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_roles_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "file_roles_file_id_analysis_id_fkey"
            columns: ["file_id", "analysis_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id"]
          },
          {
            foreignKeyName: "file_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          analysis_id: string
          bytes: number
          entry: string | null
          extension: string
          fan_in: number
          fan_out: number
          folder: string
          hash: string | null
          id: string
          lines: number
          org_id: string
          package: string | null
          parsed: boolean
          path: string
          skip_detail: string | null
          skip_reason: string | null
        }
        Insert: {
          analysis_id: string
          bytes?: number
          entry?: string | null
          extension: string
          fan_in?: number
          fan_out?: number
          folder: string
          hash?: string | null
          id?: string
          lines?: number
          org_id: string
          package?: string | null
          parsed?: boolean
          path: string
          skip_detail?: string | null
          skip_reason?: string | null
        }
        Update: {
          analysis_id?: string
          bytes?: number
          entry?: string | null
          extension?: string
          fan_in?: number
          fan_out?: number
          folder?: string
          hash?: string | null
          id?: string
          lines?: number
          org_id?: string
          package?: string | null
          parsed?: boolean
          path?: string
          skip_detail?: string | null
          skip_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      insights: {
        Row: {
          analysis_id: string
          created_at: string
          detail: Json
          file_id: string | null
          id: string
          kind: string
          org_id: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          detail?: Json
          file_id?: string | null
          id?: string
          kind: string
          org_id: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          detail?: Json
          file_id?: string | null
          id?: string
          kind?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "insights_file_id_analysis_id_fkey"
            columns: ["file_id", "analysis_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id"]
          },
          {
            foreignKeyName: "insights_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          id: string
          org_id: string
          repo_name: string
          repo_owner: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          repo_name: string
          repo_owner: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          repo_name?: string
          repo_owner?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_labels: {
        Row: {
          cache_key: string
          created_at: string
          model: string
          org_id: string
          role: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          model: string
          org_id: string
          role: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          model?: string
          org_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_labels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          analysis_id: string
          file_id: string
          id: string
          line: number
          method: string
          org_id: string
          path: string
        }
        Insert: {
          analysis_id: string
          file_id: string
          id?: string
          line: number
          method: string
          org_id: string
          path: string
        }
        Update: {
          analysis_id?: string
          file_id?: string
          id?: string
          line?: number
          method?: string
          org_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "routes_file_id_analysis_id_fkey"
            columns: ["file_id", "analysis_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id"]
          },
          {
            foreignKeyName: "routes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      neighbourhood: {
        Args: { member_paths: string[]; target_analysis: string }
        Returns: Json
      }
      store_parse_result: {
        Args: {
          claimed_started_at: string
          model_roles: Json
          parse_result: Json
          target_analysis: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  T extends keyof DefaultSchema["Tables"],
> = DefaultSchema["Tables"][T]["Row"]
